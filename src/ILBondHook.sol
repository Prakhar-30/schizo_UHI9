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

/// @title ILBondHook — Split LP Position Into Yield Token (FEE-T) + Risk Token (IL-T)
/// @notice Each LP position is unbundled into two ERC20-style claims:
///         FEE-T = claim on swap fees + upfront premium
///         IL-T  = claim on the underlying LP composition (bears IL)
///         A Reactive Smart Contract marks IL-T to market off every swap.
contract ILBondHook is BaseHook, AbstractCallback, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using CurrencySettler for Currency;

    // ══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ══════════════════════════════════════════════════════════════════════

    error OnlyPositionOwner();
    error NotFeeHolder();
    error NotILHolder();
    error PositionNotActive();
    error PositionAlreadyExited();
    error PoolNotInitialized();
    error OnlyPoolManager();
    error InvalidPremium();
    error NoBuyer();
    error NothingToWithdraw();

    // ══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ══════════════════════════════════════════════════════════════════════

    event SwapOccurred(PoolId indexed poolId, uint160 sqrtPriceX96, int24 tick, uint128 liquidity);
    event PositionCreated(uint256 indexed positionId, address indexed owner, uint160 entrySqrtPriceX96);
    event PositionExited(uint256 indexed positionId);
    event ILBondSold(uint256 indexed positionId, address indexed buyer, uint256 premium);
    event ILMarkUpdated(uint256 indexed positionId, int256 ilBps, uint256 markValue);
    event FeeTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to);
    event ILTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to);
    event ILBondDataBundle(uint256 indexed bundleId, bytes data);
    event CycleCompleted(uint256 timestamp, uint256 positionsChecked);

    // ══════════════════════════════════════════════════════════════════════
    //                          DATA STRUCTURES
    // ══════════════════════════════════════════════════════════════════════

    struct Position {
        address lp;                 // original depositor
        address feeHolder;          // owner of FEE-T (yield + premium)
        address ilHolder;           // owner of IL-T (bears price-driven outcome)
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint160 entrySqrtPriceX96;
        bool active;
        uint256 askPremium;         // premium IL-T buyer pays to FEE-T holder
        bool ilBondSold;            // whether IL-T has been transferred to a buyer
        int256 ilMarkBps;           // last-known IL mark in BPS (signed: negative=loss to ILHolder)
        uint256 markValue;          // last-known mark value (informational)
    }

    struct PositionData {
        uint256 positionId;
        uint160 entrySqrtPriceX96;
        uint160 sqrtPriceLower;
        uint160 sqrtPriceUpper;
        uint128 liquidity;
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
    //                            CONSTANTS
    // ══════════════════════════════════════════════════════════════════════

    uint24 public constant BASE_FEE = 3000;
    uint256 public constant BPS = 10000;
    uint256 public constant PRECISION = 1e18;

    // ══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ══════════════════════════════════════════════════════════════════════

    uint256 public nextPositionId;
    uint256 public bundleCounter;
    mapping(uint256 => Position) internal _positions;
    mapping(address => WithdrawableBalance) public withdrawable;

    // Track active positions for the RC bundle
    uint256[] public activePositionIds;
    mapping(uint256 => uint256) internal _activeIndex;
    mapping(PoolId => bool) public poolInitialized;

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
    //          DEPOSIT — opens position, mints FEE-T + IL-T to LP
    // ══════════════════════════════════════════════════════════════════════

    function depositILBond(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidityAmount,
        uint256 amount0Max,
        uint256 amount1Max,
        uint256 askPremium
    ) external returns (uint256 positionId) {
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
        Position storage pos = _positions[positionId];
        pos.lp = msg.sender;
        pos.feeHolder = msg.sender;     // initially LP holds both
        pos.ilHolder = msg.sender;
        pos.poolKey = key;
        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidityAmount;
        pos.entrySqrtPriceX96 = sqrtPriceX96;
        pos.active = true;
        pos.askPremium = askPremium;

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

        _activeIndex[positionId] = activePositionIds.length;
        activePositionIds.push(positionId);

        emit PositionCreated(positionId, msg.sender, sqrtPriceX96);
    }

    // ══════════════════════════════════════════════════════════════════════
    //         IL-T BUYER PURCHASES THE RISK LEG (pays premium in token1)
    // ══════════════════════════════════════════════════════════════════════

    function buyILBond(uint256 positionId) external {
        Position storage pos = _positions[positionId];
        if (!pos.active) revert PositionNotActive();
        if (pos.ilBondSold) revert PositionAlreadyExited();
        uint256 ask = pos.askPremium;
        if (ask == 0) revert InvalidPremium();

        Currency premiumCurrency = pos.poolKey.currency1;
        if (!premiumCurrency.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(premiumCurrency)).transferFrom(msg.sender, address(this), ask);
        }

        // IL-T transferred to buyer; premium credited to current FEE-T holder
        address prevILHolder = pos.ilHolder;
        pos.ilHolder = msg.sender;
        pos.ilBondSold = true;
        withdrawable[pos.feeHolder].amount1 += ask;

        emit ILTokenTransferred(positionId, prevILHolder, msg.sender);
        emit ILBondSold(positionId, msg.sender, ask);
    }

    // ══════════════════════════════════════════════════════════════════════
    //         FEE-T TRANSFER — current holder can transfer the yield leg
    // ══════════════════════════════════════════════════════════════════════

    function transferFeeToken(uint256 positionId, address to) external {
        Position storage pos = _positions[positionId];
        if (pos.feeHolder != msg.sender) revert NotFeeHolder();
        pos.feeHolder = to;
        emit FeeTokenTransferred(positionId, msg.sender, to);
    }

    function transferILToken(uint256 positionId, address to) external {
        Position storage pos = _positions[positionId];
        if (pos.ilHolder != msg.sender) revert NotILHolder();
        pos.ilHolder = to;
        emit ILTokenTransferred(positionId, msg.sender, to);
    }

    // ══════════════════════════════════════════════════════════════════════
    //          RC CALLBACK — UPDATE IL MARK (called by Reactive Network)
    // ══════════════════════════════════════════════════════════════════════

    function settleILMark(
        address /* sender */,
        uint256 positionId,
        int256 ilBps,
        uint256 markValue
    ) external authorizedSenderOnly {
        Position storage pos = _positions[positionId];
        if (!pos.active) return;
        pos.ilMarkBps = ilBps;
        pos.markValue = markValue;
        emit ILMarkUpdated(positionId, ilBps, markValue);
    }

    // ══════════════════════════════════════════════════════════════════════
    //          RC CALLBACK — TRIGGER DATA BUNDLE EMISSION
    // ══════════════════════════════════════════════════════════════════════

    function prepareILBondData(address /* sender */) external authorizedSenderOnly {
        uint256 n = activePositionIds.length;
        if (n == 0) {
            emit CycleCompleted(block.timestamp, 0);
            return;
        }

        // Use first position's pool to read current price (we assume RC subscribes per-pool)
        Position storage first = _positions[activePositionIds[0]];
        PoolId poolId = first.poolKey.toId();
        (uint160 currentSqrt,,,) = poolManager.getSlot0(poolId);

        PositionData[] memory pts = new PositionData[](n);
        for (uint256 i; i < n; ++i) {
            uint256 pid = activePositionIds[i];
            Position storage p = _positions[pid];
            pts[i] = PositionData({
                positionId: pid,
                entrySqrtPriceX96: p.entrySqrtPriceX96,
                sqrtPriceLower: TickMath.getSqrtPriceAtTick(p.tickLower),
                sqrtPriceUpper: TickMath.getSqrtPriceAtTick(p.tickUpper),
                liquidity: p.liquidity
            });
        }

        bytes memory pkg = abi.encode(currentSqrt, pts);
        emit ILBondDataBundle(bundleCounter++, pkg);
    }

    // ══════════════════════════════════════════════════════════════════════
    //          EXIT — split tokens between FEE-T and IL-T holders
    // ══════════════════════════════════════════════════════════════════════

    function exitPosition(uint256 positionId) external {
        Position storage pos = _positions[positionId];
        if (!(msg.sender == pos.lp || msg.sender == pos.feeHolder || msg.sender == pos.ilHolder)) {
            revert OnlyPositionOwner();
        }
        if (!pos.active) revert PositionNotActive();

        BalanceDelta delta = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData({
                    action: CallbackAction.REMOVE_LIQUIDITY,
                    sender: pos.lp,
                    key: pos.poolKey,
                    tickLower: pos.tickLower,
                    tickUpper: pos.tickUpper,
                    liquidityDelta: -int256(uint256(pos.liquidity)),
                    positionId: positionId
                }))
            ),
            (BalanceDelta)
        );

        uint256 amt0 = delta.amount0() > 0 ? uint256(uint128(delta.amount0())) : 0;
        uint256 amt1 = delta.amount1() > 0 ? uint256(uint128(delta.amount1())) : 0;

        // IL-T holder receives the underlying composition (bears IL outcome).
        // FEE-T holder already received the premium (and would receive accumulated swap fees
        // in a full implementation — out of scope for this simplified vault).
        withdrawable[pos.ilHolder].amount0 += amt0;
        withdrawable[pos.ilHolder].amount1 += amt1;

        pos.active = false;
        pos.liquidity = 0;
        _removeFromActive(positionId);
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
        address lp, address feeHolder, address ilHolder, bool active, bool ilBondSold,
        uint128 liquidity, uint160 entrySqrtPriceX96, int256 ilMarkBps, uint256 markValue, uint256 askPremium
    ) {
        Position storage p = _positions[positionId];
        return (p.lp, p.feeHolder, p.ilHolder, p.active, p.ilBondSold,
                p.liquidity, p.entrySqrtPriceX96, p.ilMarkBps, p.markValue, p.askPremium);
    }

    function getRange(uint256 positionId) external view returns (int24 tickLower, int24 tickUpper) {
        Position storage p = _positions[positionId];
        return (p.tickLower, p.tickUpper);
    }

    function activePositionCount() external view returns (uint256) {
        return activePositionIds.length;
    }

    function getWithdrawable(address user) external view returns (uint256, uint256) {
        WithdrawableBalance storage b = withdrawable[user];
        return (b.amount0, b.amount1);
    }

    // ══════════════════════════════════════════════════════════════════════
    //                       INTERNAL HELPERS
    // ══════════════════════════════════════════════════════════════════════

    function _removeFromActive(uint256 positionId) internal {
        uint256 idx = _activeIndex[positionId];
        uint256 last = activePositionIds.length - 1;
        if (idx != last) {
            uint256 lastId = activePositionIds[last];
            activePositionIds[idx] = lastId;
            _activeIndex[lastId] = idx;
        }
        activePositionIds.pop();
        delete _activeIndex[positionId];
    }

    receive() external payable override(AbstractPayer) {}
}
