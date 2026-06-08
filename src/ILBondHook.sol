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
    /// @notice Emitted once per pool the first time it is initialized with this hook.
    ///         Lets a frontend discover every pool the hook manages (multi-pool).
    event PoolRegistered(
        PoolId indexed poolId,
        address currency0,
        address currency1,
        int24 tickSpacing,
        uint160 sqrtPriceX96
    );
    /// @notice Emitted whenever the volatility-driven LP fee changes for a pool.
    event DynamicFeeUpdated(PoolId indexed poolId, uint24 newFeePips, uint256 volEwma);

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
        uint160 currentSqrtPriceX96;   // this position's pool price NOW (per-pool, multi-pool safe)
        uint160 sqrtPriceLower;
        uint160 sqrtPriceUpper;
        uint128 liquidity;
    }

    /// @notice Per-pool state backing the volatility-driven dynamic fee.
    struct PoolFeeState {
        int24 lastTick;       // tick recorded after the previous swap
        uint256 volEwma;      // EWMA of |Δtick| per swap — a realized-volatility proxy
        bool initialized;
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

    uint256 public constant VERSION = 3;          // bump → fresh CREATE2 address on redeploy
    uint24 public constant BASE_FEE = 3000;       // 0.30% — fee floor in calm markets
    uint24 public constant MAX_FEE = 30000;       // 3.00% — fee ceiling in turbulent markets
    uint256 public constant VOL_WINDOW = 8;       // EWMA smoothing window for realized volatility
    uint256 public constant VOL_SENSITIVITY = 2;  // pips of extra fee per (2 EWMA-ticks) of volatility
    uint256 public constant BPS = 10000;
    uint256 public constant PRECISION = 1e18;

    // ══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ══════════════════════════════════════════════════════════════════════

    uint256 public nextPositionId;
    uint256 public bundleCounter;
    mapping(uint256 => Position) internal _positions;
    // Claimable balances keyed per-token (multi-pool safe): user => token => amount.
    mapping(address => mapping(address => uint256)) public claimable;

    // Track active positions for the RC bundle
    uint256[] public activePositionIds;
    mapping(uint256 => uint256) internal _activeIndex;
    mapping(PoolId => bool) public poolInitialized;
    mapping(PoolId => PoolFeeState) public poolFeeState;

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

    function _afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        internal override returns (bytes4)
    {
        PoolId poolId = key.toId();
        poolInitialized[poolId] = true;
        // Seed the fee state at the pool's opening tick so volatility is measured
        // from initialization, and the first swap is charged the base fee.
        poolFeeState[poolId] = PoolFeeState({lastTick: tick, volEwma: 0, initialized: true});
        emit PoolRegistered(
            poolId,
            Currency.unwrap(key.currency0),
            Currency.unwrap(key.currency1),
            key.tickSpacing,
            sqrtPriceX96
        );
        return BaseHook.afterInitialize.selector;
    }

    /// @dev Dynamic fee: charge the volatility-adjusted fee computed from prior
    ///      swaps. beforeSwap fires before this swap mutates price, so the fee is
    ///      a causal function of *realized* volatility up to (not including) now.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal view override returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint24 fee = _dynamicFee(key.toId());
        return (
            BaseHook.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            LPFeeLibrary.OVERRIDE_FEE_FLAG | fee
        );
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        internal override returns (bytes4, int128)
    {
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(poolId);
        uint128 liquidity = poolManager.getLiquidity(poolId);

        // Update the realized-volatility EWMA from how far this swap moved the tick.
        PoolFeeState storage st = poolFeeState[poolId];
        if (!st.initialized) {
            st.lastTick = tick;
            st.initialized = true;
        } else {
            uint256 delta = _absTickDelta(tick, st.lastTick);
            // EWMA: vol = (vol*(W-1) + delta) / W
            st.volEwma = (st.volEwma * (VOL_WINDOW - 1) + delta) / VOL_WINDOW;
            st.lastTick = tick;
            emit DynamicFeeUpdated(poolId, _dynamicFee(poolId), st.volEwma);
        }

        emit SwapOccurred(poolId, sqrtPriceX96, tick, liquidity);
        return (BaseHook.afterSwap.selector, 0);
    }

    // ── Dynamic-fee helpers ────────────────────────────────────────────────

    /// @notice The fee (in pips) the pool will charge on the next swap, given its
    ///         current realized-volatility state. Exposed for the UI.
    function currentFee(PoolId poolId) external view returns (uint24) {
        return _dynamicFee(poolId);
    }

    function _dynamicFee(PoolId poolId) internal view returns (uint24) {
        uint256 fee = uint256(BASE_FEE) + poolFeeState[poolId].volEwma / VOL_SENSITIVITY;
        if (fee > MAX_FEE) fee = MAX_FEE;
        return uint24(fee);
    }

    function _absTickDelta(int24 a, int24 b) internal pure returns (uint256) {
        return a >= b ? uint256(int256(a) - int256(b)) : uint256(int256(b) - int256(a));
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
        claimable[pos.feeHolder][Currency.unwrap(premiumCurrency)] += ask;

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

        // Multi-pool safe: read EACH position's own pool price, so positions across
        // different pools are marked against the correct current price.
        PositionData[] memory pts = new PositionData[](n);
        for (uint256 i; i < n; ++i) {
            uint256 pid = activePositionIds[i];
            Position storage p = _positions[pid];
            (uint160 currentSqrt,,,) = poolManager.getSlot0(p.poolKey.toId());
            pts[i] = PositionData({
                positionId: pid,
                entrySqrtPriceX96: p.entrySqrtPriceX96,
                currentSqrtPriceX96: currentSqrt,
                sqrtPriceLower: TickMath.getSqrtPriceAtTick(p.tickLower),
                sqrtPriceUpper: TickMath.getSqrtPriceAtTick(p.tickUpper),
                liquidity: p.liquidity
            });
        }

        bytes memory pkg = abi.encode(pts);
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
        // Credited per-token off this position's own pool so it is multi-pool safe.
        if (amt0 > 0) claimable[pos.ilHolder][Currency.unwrap(pos.poolKey.currency0)] += amt0;
        if (amt1 > 0) claimable[pos.ilHolder][Currency.unwrap(pos.poolKey.currency1)] += amt1;

        pos.active = false;
        pos.liquidity = 0;
        _removeFromActive(positionId);
        emit PositionExited(positionId);
    }

    /// @notice Claim the full balance owed to the caller in a specific token.
    ///         Per-token, so callers with proceeds in both tokens of a pool (or
    ///         across multiple pools) call this once per token.
    function withdraw(Currency currency) external {
        address token = Currency.unwrap(currency);
        uint256 amt = claimable[msg.sender][token];
        if (amt == 0) revert NothingToWithdraw();
        claimable[msg.sender][token] = 0;
        if (!currency.isAddressZero()) {
            IERC20Minimal(token).transfer(msg.sender, amt);
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

    /// @notice Claimable balance for `user` in a specific `token`.
    function getClaimable(address user, address token) external view returns (uint256) {
        return claimable[user][token];
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
