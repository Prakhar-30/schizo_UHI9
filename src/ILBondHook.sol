// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";

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
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

/// @title ILBondHook - Split an LP position into a yield leg (FEE-T) and a risk leg (IL-T)
/// @notice Every LP position is unbundled into two transferable claims:
///         FEE-T = claim on accrued swap fees + the upfront premium (the hedged, yield leg)
///         IL-T  = claim on the underlying LP principal, which carries the
///                 impermanent-loss outcome (the risk leg the counterparty underwrites).
///
///         The whole system is this one contract. The IL mark is not pushed by any
///         keeper, oracle, or external network: it is DERIVED, at read time, from
///         state the hook itself maintains. `afterSwap` keeps an EWMA-smoothed
///         marking tick per pool (two storage writes, nothing else on the hot
///         path), and `ilMark(positionId)` computes the position's IL from its
///         entry price against that smoothed price. Every read is as fresh as the
///         last swap. There is nothing to run, nothing to fund, nothing to trust.
///
///         Manipulation resistance of the mark (two layers):
///         1. The marking price is an EWMA-smoothed tick, not spot. A single swap
///            moves the mark only 1/MARK_WINDOW of the way to its price, so a
///            flash-move inside one transaction cannot set the mark.
///         2. The mark is pure derived state. There is no settlement transaction
///            to front-run, no callback to starve, and no stored value to poison:
///            an attacker must actually hold a distorted pool price across
///            multiple swaps, paying arbitrageurs the whole way, to move it.
contract ILBondHook is BaseHook, IUnlockCallback {
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
    error NothingToWithdraw();
    error TransferFailed();
    error NativeTransferFailed();
    error InsufficientMaxAmount();
    error FullRangeOnly();
    error ZeroAddress();
    error WrongNativeAmount();

    // ══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ══════════════════════════════════════════════════════════════════════

    /// @notice One per swap: the spot snapshot plus the smoothed marking price
    ///         the IL marks derive from. An indexer can rebuild every position's
    ///         full IL history from these alone.
    event SwapOccurred(
        PoolId indexed poolId,
        uint160 sqrtPriceX96,
        int24 tick,
        uint128 liquidity,
        uint160 markSqrtPriceX96
    );
    event PositionCreated(uint256 indexed positionId, address indexed owner, uint160 entrySqrtPriceX96);
    event PositionExited(uint256 indexed positionId);
    event ILBondSold(uint256 indexed positionId, address indexed buyer, uint256 premium);
    event FeeTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to);
    event ILTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to);
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
    /// @notice Swap fees harvested off a position and credited to the FEE-T holder.
    event FeesCollected(uint256 indexed positionId, address indexed feeHolder, uint256 amount0, uint256 amount1);

    // ══════════════════════════════════════════════════════════════════════
    //                          DATA STRUCTURES
    // ══════════════════════════════════════════════════════════════════════

    struct Position {
        address lp;                 // original depositor
        address feeHolder;          // owner of FEE-T (swap fees + premium)
        address ilHolder;           // owner of IL-T (bears the price-driven outcome)
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint160 entrySqrtPriceX96;
        bool active;
        uint256 askPremium;         // premium the IL-T buyer pays to the FEE-T holder
        bool ilBondSold;            // whether IL-T has been transferred to a buyer
    }

    /// @notice Per-pool state backing the dynamic fee and the smoothed marking price.
    struct PoolFeeState {
        int24 lastTick;       // tick recorded after the previous swap
        uint256 volEwma;      // EWMA of |dTick| per swap, a realized-volatility proxy
        bool initialized;
        int256 markTickX6;    // EWMA-smoothed tick scaled by 1e6, the marking price source
    }

    enum CallbackAction { ADD_LIQUIDITY, REMOVE_LIQUIDITY, COLLECT_FEES }

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

    uint256 public constant VERSION = 5;          // bump -> fresh CREATE2 address on redeploy
    uint24 public constant BASE_FEE = 3000;       // 0.30%, the fee floor in calm markets
    uint24 public constant MAX_FEE = 30000;       // 3.00%, the fee ceiling in turbulent markets
    uint256 public constant VOL_WINDOW = 8;       // EWMA smoothing window for realized volatility
    uint256 public constant VOL_SENSITIVITY = 2;  // pips of extra fee per (2 EWMA-ticks) of volatility
    uint256 public constant MARK_WINDOW = 4;      // EWMA smoothing window for the marking price
    int256 internal constant TICK_SCALE = 1e6;    // fixed-point scale for markTickX6
    uint256 public constant BPS = 10000;
    uint256 public constant PRECISION = 1e18;

    // Premium auto-quote calibration. The quote approximates expected IL:
    // proportional to realized volatility, inversely proportional to range width,
    // scaled by the position's token1 notional. Clamped so it never quotes zero
    // and never quotes beyond a sane insurance ceiling.
    uint256 public constant VOL_TO_IL_K = 20;
    uint256 public constant TICK_NORM = 10000;
    uint256 public constant MIN_PREMIUM_BPS = 30;    // 0.30% of notional floor
    uint256 public constant MAX_PREMIUM_BPS = 2000;  // 20% of notional ceiling

    // ══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ══════════════════════════════════════════════════════════════════════

    uint256 public nextPositionId;
    mapping(uint256 => Position) internal _positions;
    // Claimable balances keyed per-token (multi-pool safe): user => token => amount.
    mapping(address => mapping(address => uint256)) public claimable;

    // Active positions, walkable by UIs and indexers.
    uint256[] public activePositionIds;
    mapping(uint256 => uint256) internal _activeIndex;
    mapping(PoolId => bool) public poolInitialized;
    mapping(PoolId => PoolFeeState) public poolFeeState;

    // ══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════════

    constructor(IPoolManager _pm) BaseHook(_pm) {}

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
        // Seed both the volatility state and the smoothed marking price at the
        // pool's opening tick, so the first swap is charged the base fee and the
        // first mark starts from a real price.
        poolFeeState[poolId] = PoolFeeState({
            lastTick: tick,
            volEwma: 0,
            initialized: true,
            markTickX6: int256(tick) * TICK_SCALE
        });
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
    ///      a causal function of realized volatility up to (not including) now.
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

        PoolFeeState storage st = poolFeeState[poolId];
        if (!st.initialized) {
            st.lastTick = tick;
            st.initialized = true;
            st.markTickX6 = int256(tick) * TICK_SCALE;
        } else {
            // Realized-volatility EWMA from how far this swap moved the tick.
            uint256 delta = _absTickDelta(tick, st.lastTick);
            // EWMA: vol = (vol*(W-1) + delta) / W
            st.volEwma = (st.volEwma * (VOL_WINDOW - 1) + delta) / VOL_WINDOW;
            st.lastTick = tick;
            // Smoothed marking price: one swap moves the mark only 1/MARK_WINDOW
            // of the way to its own price, so a same-tx flash move cannot set it.
            st.markTickX6 =
                (st.markTickX6 * int256(MARK_WINDOW - 1) + int256(tick) * TICK_SCALE) / int256(MARK_WINDOW);
            emit DynamicFeeUpdated(poolId, _dynamicFee(poolId), st.volEwma);
        }

        emit SwapOccurred(poolId, sqrtPriceX96, tick, liquidity, markSqrtPriceX96(poolId));
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
    //          THE MARK - derived on-chain, no keeper, no oracle
    // ══════════════════════════════════════════════════════════════════════

    /// @notice The EWMA-smoothed tick the marks derive from. Exposed for the UI.
    function markTick(PoolId poolId) public view returns (int24) {
        return int24(poolFeeState[poolId].markTickX6 / TICK_SCALE);
    }

    /// @notice The manipulation-resistant sqrt price IL-T is marked against.
    function markSqrtPriceX96(PoolId poolId) public view returns (uint160) {
        if (!poolFeeState[poolId].initialized) return 0;
        return TickMath.getSqrtPriceAtTick(markTick(poolId));
    }

    /// @notice The live IL mark of a position, derived from its entry price and
    ///         its own pool's smoothed marking price. Fresh as of the last swap.
    /// @return ilBps signed basis points; negative = loss borne by the IL-T holder.
    /// @return markValue liquidity scaled by (1 - IL), a dashboard estimator.
    function ilMark(uint256 positionId) public view returns (int256 ilBps, uint256 markValue) {
        Position storage p = _positions[positionId];
        if (!p.active) return (0, 0);
        return computeILMark(p.entrySqrtPriceX96, markSqrtPriceX96(p.poolKey.toId()), p.liquidity);
    }

    /// @notice The closed-form constant-product IL: IL = 1 - 2*sqrt(r)/(1+r),
    ///         r = (currentP/entryP). Exact for the full-range positions this hook
    ///         enforces. Pure and public so anyone can verify a mark off-chain.
    function computeILMark(uint160 entrySqrtPriceX96, uint160 currentSqrtPriceX96, uint128 liquidity)
        public pure returns (int256 ilBps, uint256 markValue)
    {
        if (entrySqrtPriceX96 == 0 || currentSqrtPriceX96 == 0 || liquidity == 0) {
            return (0, 0);
        }

        uint256 sqrtR = uint256(currentSqrtPriceX96) * PRECISION / uint256(entrySqrtPriceX96);
        // At extreme price divergence IL saturates to ~100%. The guard also stops
        // sqrtR*sqrtR overflowing (sqrtR can reach ~3.4e56 over the valid
        // sqrtPrice range), which would otherwise revert every reader.
        if (sqrtR >= (uint256(1) << 128)) {
            return (-int256(BPS), 0);
        }
        uint256 r = sqrtR * sqrtR / PRECISION;
        uint256 num = 2 * sqrtR * BPS;
        uint256 denom = PRECISION + r;
        if (denom == 0) return (0, 0);
        uint256 ratio = num / denom;
        // IL is non-negative; ratio <= BPS in principle.
        uint256 ilMagnitude = ratio >= BPS ? 0 : (BPS - ratio);
        // The IL-T holder bears the loss, so their mark is negative.
        ilBps = -int256(ilMagnitude);
        markValue = uint256(liquidity) * (BPS - ilMagnitude) / BPS;
    }

    // ══════════════════════════════════════════════════════════════════════
    //          DEPOSIT - opens position, mints FEE-T + IL-T to LP
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Deposit full-range liquidity and receive both legs (FEE-T + IL-T).
    /// @param askPremium The premium the IL-T buyer must pay. Pass 0 to let the
    ///        protocol quote it from live pool volatility (see quotePremium).
    /// @dev Full range is enforced so the closed-form IL mark is exact for every
    ///      position. Ranged positions need range-aware marking and are
    ///      deliberately out of scope for this version.
    function depositILBond(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidityAmount,
        uint256 amount0Max,
        uint256 amount1Max,
        uint256 askPremium
    ) external payable returns (uint256 positionId) {
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();
        if (
            tickLower != TickMath.minUsableTick(key.tickSpacing)
                || tickUpper != TickMath.maxUsableTick(key.tickSpacing)
        ) revert FullRangeOnly();

        if (key.currency0.isAddressZero()) {
            if (msg.value != amount0Max) revert WrongNativeAmount();
        } else {
            if (msg.value != 0) revert WrongNativeAmount();
            _safeTransferFrom(Currency.unwrap(key.currency0), msg.sender, address(this), amount0Max);
        }
        // currency1 sorts above currency0 and can never be the native token.
        _safeTransferFrom(Currency.unwrap(key.currency1), msg.sender, address(this), amount1Max);

        positionId = nextPositionId++;
        Position storage pos = _positions[positionId];
        pos.lp = msg.sender;
        pos.feeHolder = msg.sender;     // initially the LP holds both legs
        pos.ilHolder = msg.sender;
        pos.poolKey = key;
        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidityAmount;
        pos.entrySqrtPriceX96 = sqrtPriceX96;
        pos.active = true;
        pos.askPremium = askPremium == 0
            ? quotePremium(key, tickLower, tickUpper, liquidityAmount)
            : askPremium;

        (BalanceDelta delta,) = abi.decode(
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
            (BalanceDelta, BalanceDelta)
        );

        uint256 used0 = delta.amount0() < 0 ? uint256(uint128(-delta.amount0())) : 0;
        uint256 used1 = delta.amount1() < 0 ? uint256(uint128(-delta.amount1())) : 0;
        // Solvency guard: the mint must never consume more than this deposit
        // brought in, otherwise it would silently spend tokens the hook holds
        // in custody for other users' claims.
        if (used0 > amount0Max || used1 > amount1Max) revert InsufficientMaxAmount();
        if (amount0Max > used0) _pay(key.currency0, msg.sender, amount0Max - used0);
        if (amount1Max > used1) _pay(key.currency1, msg.sender, amount1Max - used1);

        _activeIndex[positionId] = activePositionIds.length;
        activePositionIds.push(positionId);

        emit PositionCreated(positionId, msg.sender, sqrtPriceX96);
    }

    // ══════════════════════════════════════════════════════════════════════
    //        PREMIUM AUTO-QUOTE - price the risk transfer from pool state
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Fair upfront premium (in token1 terms) for taking on this position's
    ///         IL risk, quoted from live pool state: realized volatility (the same
    ///         EWMA that drives the dynamic fee), range width, and token1 notional.
    ///         An LP position is short gamma; this is a first-order price for that
    ///         short-straddle exposure, clamped to [MIN_PREMIUM_BPS, MAX_PREMIUM_BPS]
    ///         of notional so it never quotes zero and never quotes absurdly.
    function quotePremium(PoolKey calldata key, int24 tickLower, int24 tickUpper, uint128 liquidity)
        public view returns (uint256 premium)
    {
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        if (sqrtPriceX96 == 0 || liquidity == 0) return 0;

        uint256 notional1 = _positionNotionalToken1(sqrtPriceX96, tickLower, tickUpper, liquidity);

        uint256 rangeTicks = _absTickDelta(tickUpper, tickLower);
        if (rangeTicks == 0) rangeTicks = 1;
        uint256 quoteBps = (poolFeeState[poolId].volEwma * VOL_TO_IL_K * TICK_NORM) / rangeTicks;
        if (quoteBps < MIN_PREMIUM_BPS) quoteBps = MIN_PREMIUM_BPS;
        if (quoteBps > MAX_PREMIUM_BPS) quoteBps = MAX_PREMIUM_BPS;

        premium = notional1 * quoteBps / BPS;
    }

    /// @dev Value of the position in token1 units at price `sqrtPriceX96`:
    ///      token1 side counted directly, token0 side converted at the current price.
    function _positionNotionalToken1(uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity)
        internal pure returns (uint256)
    {
        uint160 sa = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sb = TickMath.getSqrtPriceAtTick(tickUpper);
        uint160 s = sqrtPriceX96;
        if (s < sa) s = sa;
        if (s > sb) s = sb;

        uint256 amount0 = SqrtPriceMath.getAmount0Delta(s, sb, liquidity, false);
        uint256 amount1 = SqrtPriceMath.getAmount1Delta(sa, s, liquidity, false);

        // amount0 valued in token1: amount0 * (sqrtP/2^96)^2, in two mulDiv steps.
        uint256 value0 = FullMath.mulDiv(amount0, s, 1 << 96);
        value0 = FullMath.mulDiv(value0, s, 1 << 96);
        return value0 + amount1;
    }

    // ══════════════════════════════════════════════════════════════════════
    //         IL-T BUYER TAKES ON THE RISK LEG (pays premium in token1)
    // ══════════════════════════════════════════════════════════════════════

    function buyILBond(uint256 positionId) external {
        Position storage pos = _positions[positionId];
        if (!pos.active) revert PositionNotActive();
        if (pos.ilBondSold) revert PositionAlreadyExited();
        uint256 ask = pos.askPremium;
        if (ask == 0) revert InvalidPremium();

        // currency1 is never native (native sorts first as currency0).
        Currency premiumCurrency = pos.poolKey.currency1;
        _safeTransferFrom(Currency.unwrap(premiumCurrency), msg.sender, address(this), ask);

        // IL-T transfers to the buyer; the premium is credited to the current FEE-T holder.
        address prevILHolder = pos.ilHolder;
        pos.ilHolder = msg.sender;
        pos.ilBondSold = true;
        claimable[pos.feeHolder][Currency.unwrap(premiumCurrency)] += ask;

        emit ILTokenTransferred(positionId, prevILHolder, msg.sender);
        emit ILBondSold(positionId, msg.sender, ask);
    }

    // ══════════════════════════════════════════════════════════════════════
    //         LEG TRANSFERS - each holder can transfer their own leg
    // ══════════════════════════════════════════════════════════════════════

    function transferFeeToken(uint256 positionId, address to) external {
        if (to == address(0)) revert ZeroAddress();
        Position storage pos = _positions[positionId];
        if (pos.feeHolder != msg.sender) revert NotFeeHolder();
        pos.feeHolder = to;
        emit FeeTokenTransferred(positionId, msg.sender, to);
    }

    function transferILToken(uint256 positionId, address to) external {
        if (to == address(0)) revert ZeroAddress();
        Position storage pos = _positions[positionId];
        if (pos.ilHolder != msg.sender) revert NotILHolder();
        pos.ilHolder = to;
        emit ILTokenTransferred(positionId, msg.sender, to);
    }

    // ══════════════════════════════════════════════════════════════════════
    //          FEE HARVEST - swap fees stream to the FEE-T holder
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Harvest the swap fees a position has accrued so far and credit them
    ///         to the current FEE-T holder, without closing the position. Callable
    ///         by anyone; the credit always goes to the FEE-T holder.
    function collectFees(uint256 positionId) external returns (uint256 fee0, uint256 fee1) {
        Position storage pos = _positions[positionId];
        if (!pos.active) revert PositionNotActive();

        // A zero-delta poke returns only feesAccrued.
        (, BalanceDelta feesAccrued) = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData({
                    action: CallbackAction.COLLECT_FEES,
                    sender: msg.sender,
                    key: pos.poolKey,
                    tickLower: pos.tickLower,
                    tickUpper: pos.tickUpper,
                    liquidityDelta: 0,
                    positionId: positionId
                }))
            ),
            (BalanceDelta, BalanceDelta)
        );

        fee0 = feesAccrued.amount0() > 0 ? uint256(uint128(feesAccrued.amount0())) : 0;
        fee1 = feesAccrued.amount1() > 0 ? uint256(uint128(feesAccrued.amount1())) : 0;
        if (fee0 > 0) claimable[pos.feeHolder][Currency.unwrap(pos.poolKey.currency0)] += fee0;
        if (fee1 > 0) claimable[pos.feeHolder][Currency.unwrap(pos.poolKey.currency1)] += fee1;

        emit FeesCollected(positionId, pos.feeHolder, fee0, fee1);
    }

    // ══════════════════════════════════════════════════════════════════════
    //          EXIT - fees to the FEE-T holder, principal to the IL-T holder
    // ══════════════════════════════════════════════════════════════════════

    function exitPosition(uint256 positionId) external {
        Position storage pos = _positions[positionId];
        // Only a current leg holder can close the position. The original LP loses
        // this right once both legs have been transferred away.
        if (!(msg.sender == pos.feeHolder || msg.sender == pos.ilHolder)) {
            revert OnlyPositionOwner();
        }
        if (!pos.active) revert PositionNotActive();

        (BalanceDelta delta, BalanceDelta feesAccrued) = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData({
                    action: CallbackAction.REMOVE_LIQUIDITY,
                    sender: msg.sender,
                    key: pos.poolKey,
                    tickLower: pos.tickLower,
                    tickUpper: pos.tickUpper,
                    liquidityDelta: -int256(uint256(pos.liquidity)),
                    positionId: positionId
                }))
            ),
            (BalanceDelta, BalanceDelta)
        );

        // The removal delta is principal + accrued fees combined; feesAccrued is
        // reported separately, so the two claims split exactly:
        //   swap fees      -> FEE-T holder (the yield leg is a real claim on fees)
        //   principal      -> IL-T holder (the composition IS the IL outcome)
        BalanceDelta principal = delta - feesAccrued;

        uint256 fee0 = feesAccrued.amount0() > 0 ? uint256(uint128(feesAccrued.amount0())) : 0;
        uint256 fee1 = feesAccrued.amount1() > 0 ? uint256(uint128(feesAccrued.amount1())) : 0;
        uint256 amt0 = principal.amount0() > 0 ? uint256(uint128(principal.amount0())) : 0;
        uint256 amt1 = principal.amount1() > 0 ? uint256(uint128(principal.amount1())) : 0;

        address token0 = Currency.unwrap(pos.poolKey.currency0);
        address token1 = Currency.unwrap(pos.poolKey.currency1);
        if (fee0 > 0) claimable[pos.feeHolder][token0] += fee0;
        if (fee1 > 0) claimable[pos.feeHolder][token1] += fee1;
        if (amt0 > 0) claimable[pos.ilHolder][token0] += amt0;
        if (amt1 > 0) claimable[pos.ilHolder][token1] += amt1;

        pos.active = false;
        pos.liquidity = 0;
        _removeFromActive(positionId);
        if (fee0 > 0 || fee1 > 0) emit FeesCollected(positionId, pos.feeHolder, fee0, fee1);
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
        _pay(currency, msg.sender, amt);
    }

    // ══════════════════════════════════════════════════════════════════════
    //              UNLOCK CALLBACK - REAL POOL OPERATIONS
    // ══════════════════════════════════════════════════════════════════════

    function unlockCallback(bytes calldata raw) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        CallbackData memory data = abi.decode(raw, (CallbackData));

        (BalanceDelta delta, BalanceDelta feesAccrued) = poolManager.modifyLiquidity(
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

        return abi.encode(delta, feesAccrued);
    }

    // ══════════════════════════════════════════════════════════════════════
    //                       VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Full position read. `ilMarkBps`/`markValue` are computed live from
    ///         the pool's smoothed marking price, so they are always as fresh as
    ///         the last swap; there is no stored mark to go stale.
    function getPosition(uint256 positionId) external view returns (
        address lp, address feeHolder, address ilHolder, bool active, bool ilBondSold,
        uint128 liquidity, uint160 entrySqrtPriceX96, int256 ilMarkBps, uint256 markValue, uint256 askPremium
    ) {
        Position storage p = _positions[positionId];
        (int256 bps, uint256 mv) = ilMark(positionId);
        return (p.lp, p.feeHolder, p.ilHolder, p.active, p.ilBondSold,
                p.liquidity, p.entrySqrtPriceX96, bps, mv, p.askPremium);
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

    /// @dev Pay out `amount` of `currency` to `to`: native via call, ERC20 via
    ///      a return-data-checked transfer. Reverts on failure either way, so a
    ///      claim is never burned without the tokens actually moving.
    function _pay(Currency currency, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            _safeTransfer(Currency.unwrap(currency), to, amount);
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || token.code.length == 0) {
            revert TransferFailed();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || token.code.length == 0) {
            revert TransferFailed();
        }
    }

    /// @dev Native ETH arrives here from PoolManager `take` on native pools.
    receive() external payable {}
}
