// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {AbstractCallback} from "reactive-lib/src/abstract-base/AbstractCallback.sol";
import {AbstractPayer} from "reactive-lib/src/abstract-base/AbstractPayer.sol";

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

/// @title CoveredLPHook — LPs Get Paid Premium for the Upside They Already Sold
/// @notice Every concentrated LP at upper bound pU is implicitly short a call.
///         This hook auto-mints + sells that call. LP collects premium for risk
///         it was already bearing. Reactive Smart Contract handles pricing &
///         lifecycle (mark-to-market on swaps, expiry settlement on cron).
contract CoveredLPHook is BaseHook, AbstractCallback, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using CurrencySettler for Currency;

    // ══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ══════════════════════════════════════════════════════════════════════

    error OnlyPositionOwner();
    error PositionNotActive();
    error OptionNotPending();
    error OptionAlreadySettled();
    error PoolNotInitialized();
    error InsufficientPremium();
    error OnlyPoolManager();
    error NothingToWithdraw();
    error InvalidExpiry();

    // ══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ══════════════════════════════════════════════════════════════════════

    event SwapOccurred(PoolId indexed poolId, uint160 sqrtPriceX96, int24 tick, uint128 liquidity);
    event PositionCreated(uint256 indexed positionId, address indexed owner, uint160 strikeSqrtPriceX96, uint64 expiry);
    event PositionExited(uint256 indexed positionId);
    event OptionMinted(uint256 indexed optionId, uint256 indexed positionId, uint160 strikeSqrtPriceX96, uint64 expiry, uint256 askPremium);
    event OptionPurchased(uint256 indexed optionId, address indexed buyer, uint256 premiumPaid);
    event OptionPremiumUpdated(uint256 indexed optionId, uint256 newAskPremium);
    event OptionSettled(uint256 indexed optionId, bool exercised, uint256 settlementToBuyer);
    event CoveredDataBundle(uint256 indexed bundleId, bytes data);
    event CycleCompleted(uint256 timestamp, uint256 optionsChecked, uint256 actionsEmitted);

    // ══════════════════════════════════════════════════════════════════════
    //                          DATA STRUCTURES
    // ══════════════════════════════════════════════════════════════════════

    enum OptionStatus { PENDING, SOLD, SETTLED }

    struct Position {
        address owner;
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint160 entrySqrtPriceX96;
        uint160 strikeSqrtPriceX96; // == sqrtPrice at upper tick
        uint64 expiry;
        bool active;
        uint256 optionId;
    }

    struct Option {
        uint256 positionId;
        uint160 strikeSqrtPriceX96;
        uint64 expiry;
        uint256 askPremium;       // current premium asked from buyer (token1)
        uint256 paidPremium;      // premium actually paid (once SOLD)
        address buyer;
        OptionStatus status;
        uint256 notional;         // token0 notional at strike (mirrors LP exposure)
    }

    struct OptionDataPoint {
        uint256 optionId;
        uint160 strikeSqrtPriceX96;
        uint64 expiry;
        uint256 currentAsk;
        uint256 notional;
        uint8 status; // 0/1/2
    }

    struct WithdrawableBalance {
        uint256 amount0;
        uint256 amount1;
    }

    enum CallbackAction { ADD_LIQUIDITY, REMOVE_LIQUIDITY }

    struct CallbackData {
        CallbackAction action;
        address sender;
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        uint256 positionId;
    }

    // ══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ══════════════════════════════════════════════════════════════════════

    uint256 public nextPositionId;
    uint256 public nextOptionId;
    uint256 public bundleCounter;

    mapping(uint256 => Position) internal _positions;
    mapping(uint256 => Option) internal _options;
    mapping(address => WithdrawableBalance) public withdrawable;

    uint256[] public activeOptionIds;
    mapping(uint256 => uint256) internal _activeOptionIndex;
    mapping(PoolId => bool) public poolInitialized;

    uint24 public constant BASE_FEE = 3000;
    uint256 public constant BPS = 10000;

    // ══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════════

    constructor(IPoolManager _pm, address _callbackSender)
        BaseHook(_pm)
        AbstractCallback(_callbackSender)
    {}

    // ══════════════════════════════════════════════════════════════════════
    //                        HOOK PERMISSIONS
    // ══════════════════════════════════════════════════════════════════════

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _afterInitialize(address, PoolKey calldata key, uint160, int24)
        internal override returns (bytes4)
    {
        poolInitialized[key.toId()] = true;
        return BaseHook.afterInitialize.selector;
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal pure override returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (
            BaseHook.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            LPFeeLibrary.OVERRIDE_FEE_FLAG | BASE_FEE
        );
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        internal override returns (bytes4, int128)
    {
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(poolId);
        uint128 liquidity = poolManager.getLiquidity(poolId);
        emit SwapOccurred(poolId, sqrtPriceX96, tick, liquidity);
        return (BaseHook.afterSwap.selector, 0);
    }

    // ══════════════════════════════════════════════════════════════════════
    //          DEPOSIT — opens position + auto-mints covered call
    // ══════════════════════════════════════════════════════════════════════

    function depositCoveredLP(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidityAmount,
        uint256 amount0Max,
        uint256 amount1Max,
        uint64 durationSeconds,
        uint256 initialAskPremium
    ) external returns (uint256 positionId, uint256 optionId) {
        if (durationSeconds == 0 || durationSeconds > 30 days) revert InvalidExpiry();

        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();

        if (!key.currency0.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(key.currency0)).transferFrom(msg.sender, address(this), amount0Max);
        }
        if (!key.currency1.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(key.currency1)).transferFrom(msg.sender, address(this), amount1Max);
        }

        positionId = nextPositionId++;
        uint160 strike = TickMath.getSqrtPriceAtTick(tickUpper);
        uint64 expiry = uint64(block.timestamp + durationSeconds);

        Position storage pos = _positions[positionId];
        pos.owner = msg.sender;
        pos.poolKey = key;
        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidityAmount;
        pos.entrySqrtPriceX96 = sqrtPriceX96;
        pos.strikeSqrtPriceX96 = strike;
        pos.expiry = expiry;
        pos.active = true;

        BalanceDelta delta = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData({
                    action: CallbackAction.ADD_LIQUIDITY,
                    sender: msg.sender,
                    key: key,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: int256(uint256(liquidityAmount)),
                    positionId: positionId
                }))
            ),
            (BalanceDelta)
        );

        uint256 used0 = delta.amount0() < 0 ? uint256(uint128(-delta.amount0())) : 0;
        uint256 used1 = delta.amount1() < 0 ? uint256(uint128(-delta.amount1())) : 0;
        if (amount0Max > used0 && !key.currency0.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(key.currency0)).transfer(msg.sender, amount0Max - used0);
        }
        if (amount1Max > used1 && !key.currency1.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(key.currency1)).transfer(msg.sender, amount1Max - used1);
        }

        // Mint the covered call option against this position
        optionId = nextOptionId++;
        Option storage opt = _options[optionId];
        opt.positionId = positionId;
        opt.strikeSqrtPriceX96 = strike;
        opt.expiry = expiry;
        opt.askPremium = initialAskPremium;
        opt.notional = uint256(liquidityAmount);
        opt.status = OptionStatus.PENDING;
        pos.optionId = optionId;

        _activeOptionIndex[optionId] = activeOptionIds.length;
        activeOptionIds.push(optionId);

        emit PositionCreated(positionId, msg.sender, strike, expiry);
        emit OptionMinted(optionId, positionId, strike, expiry, initialAskPremium);
    }

    // ══════════════════════════════════════════════════════════════════════
    //         BUYER PURCHASES OPTION (pays premium in token1)
    // ══════════════════════════════════════════════════════════════════════

    function purchaseOption(uint256 optionId, uint256 maxPay) external {
        Option storage opt = _options[optionId];
        if (opt.status != OptionStatus.PENDING) revert OptionNotPending();

        uint256 ask = opt.askPremium;
        if (ask == 0 || maxPay < ask) revert InsufficientPremium();

        Position storage pos = _positions[opt.positionId];
        Currency premiumCurrency = pos.poolKey.currency1;
        if (!premiumCurrency.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(premiumCurrency)).transferFrom(msg.sender, address(this), ask);
        }

        opt.paidPremium = ask;
        opt.buyer = msg.sender;
        opt.status = OptionStatus.SOLD;

        // Premium credited to LP's withdrawable balance (token1)
        withdrawable[pos.owner].amount1 += ask;

        emit OptionPurchased(optionId, msg.sender, ask);
    }

    // ══════════════════════════════════════════════════════════════════════
    //         RC CALLBACK — UPDATE PREMIUM (mark-to-market)
    // ══════════════════════════════════════════════════════════════════════

    function updateOptionPremium(address /* sender */, uint256 optionId, uint256 newAsk)
        external authorizedSenderOnly
    {
        Option storage opt = _options[optionId];
        if (opt.status != OptionStatus.PENDING) return;
        opt.askPremium = newAsk;
        emit OptionPremiumUpdated(optionId, newAsk);
    }

    // ══════════════════════════════════════════════════════════════════════
    //         RC CALLBACK — TRIGGER DATA EMISSION FOR PRICING
    // ══════════════════════════════════════════════════════════════════════

    function prepareCoveredData(address /* sender */) external authorizedSenderOnly {
        uint256 n = activeOptionIds.length;
        if (n == 0) {
            emit CycleCompleted(block.timestamp, 0, 0);
            return;
        }

        // Pull current price from the first option's pool
        Option storage first = _options[activeOptionIds[0]];
        Position storage firstPos = _positions[first.positionId];
        PoolId poolId = firstPos.poolKey.toId();
        (uint160 currentSqrt,,,) = poolManager.getSlot0(poolId);

        OptionDataPoint[] memory pts = new OptionDataPoint[](n);
        for (uint256 i; i < n; ++i) {
            uint256 oid = activeOptionIds[i];
            Option storage o = _options[oid];
            pts[i] = OptionDataPoint({
                optionId: oid,
                strikeSqrtPriceX96: o.strikeSqrtPriceX96,
                expiry: o.expiry,
                currentAsk: o.askPremium,
                notional: o.notional,
                status: uint8(o.status)
            });
        }

        bytes memory pkg = abi.encode(currentSqrt, uint64(block.timestamp), pts);
        emit CoveredDataBundle(bundleCounter++, pkg);
    }

    // ══════════════════════════════════════════════════════════════════════
    //         RC CALLBACK — SETTLE OPTION AT EXPIRY
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Settle option. Cash-settled in token1.
    ///         If pool price >= strike → option holder receives (price - strike)*notional/strike in token1
    ///         else → expires worthless.
    function settleOption(address /* sender */, uint256 optionId) external authorizedSenderOnly {
        Option storage opt = _options[optionId];
        if (opt.status == OptionStatus.SETTLED) return;
        // Only settle once expiry passed
        if (block.timestamp < opt.expiry) return;

        Position storage pos = _positions[opt.positionId];
        PoolId poolId = pos.poolKey.toId();
        (uint160 currentSqrt,,,) = poolManager.getSlot0(poolId);

        bool exercised = false;
        uint256 settlement = 0;
        if (currentSqrt > opt.strikeSqrtPriceX96 && opt.status == OptionStatus.SOLD) {
            // Compute payoff = (price^2 - strike^2)/strike^2 × notional, scaled by 1e18 → in token1 units of premium currency
            uint256 priceRatioBps = (uint256(currentSqrt) * BPS / uint256(opt.strikeSqrtPriceX96));
            // delta_bps = priceRatio² - 1²  in bps² ; we want diff in bps space
            // Approx payoff scaling: (priceBps/BPS)^2 - 1 ≈ 2 × (priceBps - BPS)/BPS for small moves
            // Use exact: payoff = (curr^2 - strike^2)/strike^2 = (curr/strike)^2 - 1
            uint256 ratioSq = priceRatioBps * priceRatioBps / BPS; // in BPS
            uint256 excessBps = ratioSq > BPS ? (ratioSq - BPS) : 0;
            // settlement in token1 ≈ excessBps × notional / BPS, capped at LP's withdrawable
            settlement = excessBps * opt.notional / BPS;
            // Cap settlement at LP's withdrawable token1 (avoids underflow)
            uint256 capacity = withdrawable[pos.owner].amount1;
            if (settlement > capacity) settlement = capacity;
            withdrawable[pos.owner].amount1 -= settlement;
            withdrawable[opt.buyer].amount1 += settlement;
            exercised = true;
        }

        opt.status = OptionStatus.SETTLED;
        _removeFromActiveOptions(optionId);

        emit OptionSettled(optionId, exercised, settlement);
    }

    // ══════════════════════════════════════════════════════════════════════
    //                        EXIT POSITION
    // ══════════════════════════════════════════════════════════════════════

    function exitPosition(uint256 positionId) external {
        Position storage pos = _positions[positionId];
        if (pos.owner != msg.sender) revert OnlyPositionOwner();
        if (!pos.active) revert PositionNotActive();

        BalanceDelta delta = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData({
                    action: CallbackAction.REMOVE_LIQUIDITY,
                    sender: pos.owner,
                    key: pos.poolKey,
                    tickLower: pos.tickLower,
                    tickUpper: pos.tickUpper,
                    liquidityDelta: -int256(uint256(pos.liquidity)),
                    positionId: positionId
                }))
            ),
            (BalanceDelta)
        );

        if (delta.amount0() > 0) withdrawable[pos.owner].amount0 += uint256(uint128(delta.amount0()));
        if (delta.amount1() > 0) withdrawable[pos.owner].amount1 += uint256(uint128(delta.amount1()));

        pos.active = false;
        pos.liquidity = 0;
        emit PositionExited(positionId);
    }

    function withdraw(Currency currency) external {
        WithdrawableBalance storage bal = withdrawable[msg.sender];
        uint256 amt0 = bal.amount0;
        uint256 amt1 = bal.amount1;
        if (amt0 == 0 && amt1 == 0) revert NothingToWithdraw();
        bal.amount0 = 0;
        bal.amount1 = 0;
        if (amt0 > 0 && !currency.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(currency)).transfer(msg.sender, amt0);
        }
        if (amt1 > 0 && !currency.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(currency)).transfer(msg.sender, amt1);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //              UNLOCK CALLBACK — REAL POOL OPERATIONS
    // ══════════════════════════════════════════════════════════════════════

    function unlockCallback(bytes calldata raw) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        CallbackData memory data = abi.decode(raw, (CallbackData));

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            data.key,
            ModifyLiquidityParams({
                tickLower: data.tickLower,
                tickUpper: data.tickUpper,
                liquidityDelta: data.liquidityDelta,
                salt: bytes32(data.positionId)
            }),
            ""
        );

        if (delta.amount0() < 0) data.key.currency0.settle(poolManager, address(this), uint256(uint128(-delta.amount0())), false);
        if (delta.amount1() < 0) data.key.currency1.settle(poolManager, address(this), uint256(uint128(-delta.amount1())), false);
        if (delta.amount0() > 0) data.key.currency0.take(poolManager, address(this), uint256(uint128(delta.amount0())), false);
        if (delta.amount1() > 0) data.key.currency1.take(poolManager, address(this), uint256(uint128(delta.amount1())), false);

        return abi.encode(delta);
    }

    // ══════════════════════════════════════════════════════════════════════
    //                       VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════

    function getPosition(uint256 positionId) external view returns (
        address owner, bool active, uint128 liquidity, int24 tickLower, int24 tickUpper,
        uint160 entrySqrtPriceX96, uint160 strikeSqrtPriceX96, uint64 expiry, uint256 optionId
    ) {
        Position storage p = _positions[positionId];
        return (p.owner, p.active, p.liquidity, p.tickLower, p.tickUpper,
                p.entrySqrtPriceX96, p.strikeSqrtPriceX96, p.expiry, p.optionId);
    }

    function getOption(uint256 optionId) external view returns (
        uint256 positionId, uint160 strike, uint64 expiry, uint256 askPremium,
        uint256 paidPremium, address buyer, uint8 status, uint256 notional
    ) {
        Option storage o = _options[optionId];
        return (o.positionId, o.strikeSqrtPriceX96, o.expiry, o.askPremium,
                o.paidPremium, o.buyer, uint8(o.status), o.notional);
    }

    function activeOptionCount() external view returns (uint256) {
        return activeOptionIds.length;
    }

    function getWithdrawable(address user) external view returns (uint256, uint256) {
        WithdrawableBalance storage b = withdrawable[user];
        return (b.amount0, b.amount1);
    }

    // ══════════════════════════════════════════════════════════════════════
    //                       INTERNAL HELPERS
    // ══════════════════════════════════════════════════════════════════════

    function _removeFromActiveOptions(uint256 optionId) internal {
        uint256 idx = _activeOptionIndex[optionId];
        uint256 last = activeOptionIds.length - 1;
        if (idx != last) {
            uint256 lastId = activeOptionIds[last];
            activeOptionIds[idx] = lastId;
            _activeOptionIndex[lastId] = idx;
        }
        activeOptionIds.pop();
        delete _activeOptionIndex[optionId];
    }

    receive() external payable override(AbstractPayer) {}
}
