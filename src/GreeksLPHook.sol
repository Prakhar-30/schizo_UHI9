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

/// @title GreeksLPHook — Options-Greeks-Aware LP Risk Management
/// @notice Treats each LP position as a short options position and manages risk
///         using delta, gamma, theta, and vega — computed by a Reactive Smart Contract.
///         Acts as both a Uniswap V4 Hook and a Reactive Network Callback Contract.
contract GreeksLPHook is BaseHook, AbstractCallback, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using CurrencySettler for Currency;

    // ══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ══════════════════════════════════════════════════════════════════════

    error OnlyPositionOwner();
    error PositionNotActive();
    error NothingToWithdraw();
    error PoolNotInitialized();
    error InvalidProfile();
    error OnlyPoolManager();

    // ══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Emitted after every swap — RC uses for price tracking
    event SwapOccurred(PoolId indexed poolId, uint160 sqrtPriceX96, int24 tick, uint128 liquidity);

    /// @notice New position deposited — RC subscribes for lifecycle mgmt
    event PositionCreated(uint256 indexed positionId, address indexed owner);

    /// @notice Position fully exited — RC subscribes for lifecycle mgmt
    event PositionExited(uint256 indexed positionId);

    /// @notice Position range adjusted by RC
    event PositionAdjusted(uint256 indexed positionId, uint8 indexed action, int24 newTickLower, int24 newTickUpper);

    /// @notice Greeks updated by RC computation
    event GreeksUpdated(uint256 indexed positionId, int256 delta, uint256 gamma, uint256 theta, uint256 vega);

    /// @notice Data bundle emitted for RC to compute Greeks off-chain
    event GreeksDataBundle(uint256 indexed bundleId, bytes data);

    /// @notice Feedback event — RC uses to confirm cycle completion
    event CycleCompleted(uint256 timestamp, uint256 positionsChecked, uint256 actionsEmitted);

    // ══════════════════════════════════════════════════════════════════════
    //                          DATA STRUCTURES
    // ══════════════════════════════════════════════════════════════════════

    struct GreekProfile {
        uint256 maxGammaBps;          // Max gamma exposure (BPS of IL per 1% move)
        uint256 minThetaGammaRatio;   // Min theta/gamma ratio (×1e18)
        uint256 maxDeltaBps;          // Max |delta| tolerance (BPS)
        uint8 vegaAction;             // On vol spike: 1=WIDEN, 6=EXIT, 0=NOTHING
    }

    struct Position {
        address owner;
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 initialLiquidity;
        uint160 entrySqrtPriceX96;
        GreekProfile profile;
        bool active;
        // Latest Greeks (written by RC via updateGreeks callback)
        int256 delta;
        uint256 gamma;
        uint256 theta;
        uint256 vega;
    }

    /// @dev Shared struct for data bundle encoding — must match RC's definition
    struct PositionData {
        uint256 posId;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint160 entrySqrtPriceX96;
        uint160 sqrtPriceLower;
        uint160 sqrtPriceUpper;
        uint256 maxGammaBps;
        uint256 minThetaGammaRatio;
        uint256 maxDeltaBps;
        uint8 vegaAction;
    }

    struct PoolInventory {
        uint256 totalToken0;
        uint256 totalToken1;
        uint24 feeAdjustBps;
        bool initialized;
    }

    struct PriceSnapshot {
        uint160 sqrtPriceX96;
        uint256 timestamp;
    }

    struct PoolMetrics {
        uint256 cumSwapVolume;
        uint256 cumSwapVolumeAtLastCheck;
        uint256 lastCheckTimestamp;
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
    uint24 public constant MAX_FEE = 10000;
    uint24 public constant MIN_FEE = 500;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_SNAPSHOTS = 30;

    // ══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ══════════════════════════════════════════════════════════════════════

    uint256 public nextPositionId;
    uint256 public bundleCounter;
    mapping(uint256 => Position) internal _positions;
    mapping(PoolId => PoolInventory) public poolInventory;
    mapping(address => WithdrawableBalance) public withdrawable;

    uint256[] public activePositionIds;
    mapping(uint256 => uint256) internal activePositionIndex;

    // Price history circular buffer (per pool)
    mapping(PoolId => PriceSnapshot[30]) public priceHistory;
    mapping(PoolId => uint256) public snapshotHead;
    mapping(PoolId => uint256) public snapshotCount;

    // Swap volume tracking (per pool)
    mapping(PoolId => PoolMetrics) public poolMetrics;

    // ══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════════

    constructor(
        IPoolManager _poolManager,
        address _callbackSender
    ) BaseHook(_poolManager) AbstractCallback(_callbackSender) {}

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

    // ══════════════════════════════════════════════════════════════════════
    //              LAYER 1: INVENTORY-AWARE DYNAMIC FEES
    // ══════════════════════════════════════════════════════════════════════

    function _beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        PoolInventory storage inv = poolInventory[poolId];

        if (!inv.initialized) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, LPFeeLibrary.OVERRIDE_FEE_FLAG | BASE_FEE);
        }

        uint256 total = inv.totalToken0 + inv.totalToken1;
        if (total == 0) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, LPFeeLibrary.OVERRIDE_FEE_FLAG | BASE_FEE);
        }

        uint256 token0RatioBps = (inv.totalToken0 * BPS_DENOMINATOR) / total;
        int256 skew = int256(token0RatioBps) - 5000;

        uint24 fee;
        if (params.zeroForOne) {
            if (skew > 0) {
                uint256 penalty = uint256(skew) * uint256(inv.feeAdjustBps) / BPS_DENOMINATOR;
                fee = uint24(_min(BASE_FEE + penalty, MAX_FEE));
            } else {
                uint256 discount = uint256(-skew) * uint256(inv.feeAdjustBps) / BPS_DENOMINATOR;
                fee = uint24(_max(BASE_FEE - discount, MIN_FEE));
            }
        } else {
            if (skew < 0) {
                uint256 penalty = uint256(-skew) * uint256(inv.feeAdjustBps) / BPS_DENOMINATOR;
                fee = uint24(_min(BASE_FEE + penalty, MAX_FEE));
            } else {
                uint256 discount = uint256(skew) * uint256(inv.feeAdjustBps) / BPS_DENOMINATOR;
                fee = uint24(_max(BASE_FEE - discount, MIN_FEE));
            }
        }

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, LPFeeLibrary.OVERRIDE_FEE_FLAG | fee);
    }

    // ══════════════════════════════════════════════════════════════════════
    //            AFTER SWAP — STORE PRICE SNAPSHOT + EMIT
    // ══════════════════════════════════════════════════════════════════════

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(poolId);
        uint128 liquidity = poolManager.getLiquidity(poolId);

        // Store price snapshot in circular buffer
        uint256 idx = snapshotHead[poolId] % MAX_SNAPSHOTS;
        priceHistory[poolId][idx] = PriceSnapshot({
            sqrtPriceX96: sqrtPriceX96,
            timestamp: block.timestamp
        });
        snapshotHead[poolId]++;
        if (snapshotCount[poolId] < MAX_SNAPSHOTS) {
            snapshotCount[poolId]++;
        }

        // Track swap volume for theta computation
        int256 specified = params.amountSpecified;
        poolMetrics[poolId].cumSwapVolume += specified > 0
            ? uint256(specified)
            : uint256(-specified);

        emit SwapOccurred(poolId, sqrtPriceX96, tick, liquidity);
        return (BaseHook.afterSwap.selector, 0);
    }

    // ══════════════════════════════════════════════════════════════════════
    //                     AFTER INITIALIZE
    // ══════════════════════════════════════════════════════════════════════

    function _afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24)
        internal override returns (bytes4)
    {
        PoolId poolId = key.toId();
        poolInventory[poolId].initialized = true;
        poolInventory[poolId].feeAdjustBps = 5000;
        poolMetrics[poolId].lastCheckTimestamp = block.timestamp;

        // Store initial price snapshot
        priceHistory[poolId][0] = PriceSnapshot({
            sqrtPriceX96: sqrtPriceX96,
            timestamp: block.timestamp
        });
        snapshotHead[poolId] = 1;
        snapshotCount[poolId] = 1;

        return BaseHook.afterInitialize.selector;
    }

    // ══════════════════════════════════════════════════════════════════════
    //              VAULT: DEPOSIT WITH GREEK PROFILE
    // ══════════════════════════════════════════════════════════════════════

    function depositWithGreekProfile(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidityAmount,
        uint256 amount0Max,
        uint256 amount1Max,
        GreekProfile calldata profile
    ) external returns (uint256 positionId) {
        if (profile.maxGammaBps == 0 || profile.maxGammaBps > BPS_DENOMINATOR) revert InvalidProfile();
        if (profile.maxDeltaBps == 0 || profile.maxDeltaBps > BPS_DENOMINATOR) revert InvalidProfile();

        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();

        // Transfer tokens from LP to this contract
        if (!key.currency0.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(key.currency0)).transferFrom(msg.sender, address(this), amount0Max);
        }
        if (!key.currency1.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(key.currency1)).transferFrom(msg.sender, address(this), amount1Max);
        }

        positionId = nextPositionId++;

        Position storage pos = _positions[positionId];
        pos.owner = msg.sender;
        pos.poolKey = key;
        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidityAmount;
        pos.initialLiquidity = liquidityAmount;
        pos.entrySqrtPriceX96 = sqrtPriceX96;
        pos.profile = profile;
        pos.active = true;

        activePositionIndex[positionId] = activePositionIds.length;
        activePositionIds.push(positionId);

        // Add liquidity via PoolManager unlock
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

        // Refund unused tokens
        uint256 used0 = delta.amount0() < 0 ? uint256(uint128(-delta.amount0())) : 0;
        uint256 used1 = delta.amount1() < 0 ? uint256(uint128(-delta.amount1())) : 0;

        if (amount0Max > used0 && !key.currency0.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(key.currency0)).transfer(msg.sender, amount0Max - used0);
        }
        if (amount1Max > used1 && !key.currency1.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(key.currency1)).transfer(msg.sender, amount1Max - used1);
        }

        _updateInventoryOnDeposit(poolId, sqrtPriceX96, tickLower, tickUpper, liquidityAmount);
        emit PositionCreated(positionId, msg.sender);
    }

    // ══════════════════════════════════════════════════════════════════════
    //              UNLOCK CALLBACK — REAL POOL OPERATIONS
    // ══════════════════════════════════════════════════════════════════════

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        CallbackData memory data = abi.decode(rawData, (CallbackData));

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

        if (data.action == CallbackAction.ADD_LIQUIDITY) {
            if (delta.amount0() < 0) {
                data.key.currency0.settle(poolManager, address(this), uint256(uint128(-delta.amount0())), false);
            }
            if (delta.amount1() < 0) {
                data.key.currency1.settle(poolManager, address(this), uint256(uint128(-delta.amount1())), false);
            }
            if (delta.amount0() > 0) {
                data.key.currency0.take(poolManager, address(this), uint256(uint128(delta.amount0())), false);
            }
            if (delta.amount1() > 0) {
                data.key.currency1.take(poolManager, address(this), uint256(uint128(delta.amount1())), false);
            }
        } else {
            if (delta.amount0() > 0) {
                data.key.currency0.take(poolManager, address(this), uint256(uint128(delta.amount0())), false);
            }
            if (delta.amount1() > 0) {
                data.key.currency1.take(poolManager, address(this), uint256(uint128(delta.amount1())), false);
            }
            if (delta.amount0() < 0) {
                data.key.currency0.settle(poolManager, address(this), uint256(uint128(-delta.amount0())), false);
            }
            if (delta.amount1() < 0) {
                data.key.currency1.settle(poolManager, address(this), uint256(uint128(-delta.amount1())), false);
            }
        }

        return abi.encode(delta);
    }

    // ══════════════════════════════════════════════════════════════════════
    //         RC CALLBACK: PREPARE & EMIT DATA FOR GREEKS COMPUTATION
    // ══════════════════════════════════════════════════════════════════════

    function prepareGreeksData(address /* _sender */) external authorizedSenderOnly {
        uint256 length = activePositionIds.length;
        if (length == 0) {
            emit CycleCompleted(block.timestamp, 0, 0);
            return;
        }

        // Get pool info from first active position
        Position storage firstPos = _positions[activePositionIds[0]];
        PoolId poolId = firstPos.poolKey.toId();

        // Pack price history
        uint256 count = snapshotCount[poolId];
        uint160[] memory sqrtPrices = new uint160[](count);
        uint256[] memory timestamps = new uint256[](count);

        uint256 head = snapshotHead[poolId];
        for (uint256 i = 0; i < count; i++) {
            uint256 idx;
            if (head >= count) {
                idx = (head - count + i) % MAX_SNAPSHOTS;
            } else {
                idx = i;
            }
            sqrtPrices[i] = priceHistory[poolId][idx].sqrtPriceX96;
            timestamps[i] = priceHistory[poolId][idx].timestamp;
        }

        // Pack position data with pre-computed sqrtPrice boundaries
        PositionData[] memory posData = new PositionData[](length);
        for (uint256 i = 0; i < length; i++) {
            uint256 posId = activePositionIds[i];
            Position storage pos = _positions[posId];
            posData[i] = PositionData({
                posId: posId,
                tickLower: pos.tickLower,
                tickUpper: pos.tickUpper,
                liquidity: pos.liquidity,
                entrySqrtPriceX96: pos.entrySqrtPriceX96,
                sqrtPriceLower: TickMath.getSqrtPriceAtTick(pos.tickLower),
                sqrtPriceUpper: TickMath.getSqrtPriceAtTick(pos.tickUpper),
                maxGammaBps: pos.profile.maxGammaBps,
                minThetaGammaRatio: pos.profile.minThetaGammaRatio,
                maxDeltaBps: pos.profile.maxDeltaBps,
                vegaAction: pos.profile.vegaAction
            });
        }

        // Compute metrics since last check
        uint128 totalLiquidity = poolManager.getLiquidity(poolId);
        uint256 swapVolume = poolMetrics[poolId].cumSwapVolume - poolMetrics[poolId].cumSwapVolumeAtLastCheck;
        uint256 timeDelta = block.timestamp - poolMetrics[poolId].lastCheckTimestamp;
        if (timeDelta == 0) timeDelta = 1;

        // Reset check state
        poolMetrics[poolId].cumSwapVolumeAtLastCheck = poolMetrics[poolId].cumSwapVolume;
        poolMetrics[poolId].lastCheckTimestamp = block.timestamp;

        // Encode and emit: 3 sub-bundles to avoid stack depth issues in RC decode
        bytes memory priceBytes = abi.encode(sqrtPrices, timestamps);
        bytes memory posBytes = abi.encode(posData);
        bytes memory metricsBytes = abi.encode(
            uint256(totalLiquidity),
            swapVolume,
            timeDelta,
            firstPos.poolKey.tickSpacing
        );

        emit GreeksDataBundle(
            bundleCounter++,
            abi.encode(priceBytes, posBytes, metricsBytes)
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    //         RC CALLBACK: EXECUTE POSITION ACTION
    // ══════════════════════════════════════════════════════════════════════

    /// @param action 1=WIDEN, 2=NARROW, 3=SHIFT_UP, 4=SHIFT_DOWN, 5=PARTIAL_EXIT, 6=FULL_EXIT
    function executeAction(
        address /* _sender */,
        uint256 positionId,
        uint8 action,
        int24 newTickLower,
        int24 newTickUpper
    ) external authorizedSenderOnly {
        Position storage pos = _positions[positionId];
        if (!pos.active) return;

        if (action == 6) {
            // FULL_EXIT
            _enforceExit(positionId, 100);
            _removeFromActiveList(activePositionIndex[positionId]);
        } else if (action == 5) {
            // PARTIAL_EXIT — remove 50%
            _enforceExit(positionId, 50);
        } else if (action >= 1 && action <= 4) {
            // REPOSITION: WIDEN, NARROW, SHIFT_UP, SHIFT_DOWN
            _reposition(positionId, newTickLower, newTickUpper);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //         RC CALLBACK: UPDATE GREEKS (FOR MONITORING)
    // ══════════════════════════════════════════════════════════════════════

    function updateGreeks(
        address /* _sender */,
        uint256 positionId,
        int256 delta,
        uint256 gamma,
        uint256 theta,
        uint256 vega
    ) external authorizedSenderOnly {
        Position storage pos = _positions[positionId];
        if (!pos.active) return;

        pos.delta = delta;
        pos.gamma = gamma;
        pos.theta = theta;
        pos.vega = vega;

        emit GreeksUpdated(positionId, delta, gamma, theta, vega);
    }

    // ══════════════════════════════════════════════════════════════════════
    //                    REPOSITION LOGIC
    // ══════════════════════════════════════════════════════════════════════

    function _reposition(uint256 positionId, int24 newTickLower, int24 newTickUpper) internal {
        Position storage pos = _positions[positionId];
        uint128 oldLiquidity = pos.liquidity;

        // Step 1: Remove all liquidity from old range
        BalanceDelta removeDelta = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData({
                    action: CallbackAction.REMOVE_LIQUIDITY,
                    sender: pos.owner,
                    key: pos.poolKey,
                    tickLower: pos.tickLower,
                    tickUpper: pos.tickUpper,
                    liquidityDelta: -int256(uint256(oldLiquidity)),
                    positionId: positionId
                }))
            ),
            (BalanceDelta)
        );

        uint256 avail0 = removeDelta.amount0() > 0 ? uint256(uint128(removeDelta.amount0())) : 0;
        uint256 avail1 = removeDelta.amount1() > 0 ? uint256(uint128(removeDelta.amount1())) : 0;

        // Step 2: Compute max liquidity for new range
        (uint160 currentSqrtPrice,,,) = poolManager.getSlot0(pos.poolKey.toId());
        uint128 newLiquidity = _computeMaxLiquidity(avail0, avail1, currentSqrtPrice, newTickLower, newTickUpper);

        // Apply 98% safety margin for rounding
        newLiquidity = uint128(uint256(newLiquidity) * 98 / 100);

        if (newLiquidity == 0) {
            // Can't reposition — credit all tokens to withdrawable
            withdrawable[pos.owner].amount0 += avail0;
            withdrawable[pos.owner].amount1 += avail1;
            pos.active = false;
            pos.liquidity = 0;
            emit PositionExited(positionId);
            return;
        }

        // Step 3: Add liquidity at new range
        BalanceDelta addDelta = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData({
                    action: CallbackAction.ADD_LIQUIDITY,
                    sender: pos.owner,
                    key: pos.poolKey,
                    tickLower: newTickLower,
                    tickUpper: newTickUpper,
                    liquidityDelta: int256(uint256(newLiquidity)),
                    positionId: positionId
                }))
            ),
            (BalanceDelta)
        );

        uint256 used0 = addDelta.amount0() < 0 ? uint256(uint128(-addDelta.amount0())) : 0;
        uint256 used1 = addDelta.amount1() < 0 ? uint256(uint128(-addDelta.amount1())) : 0;

        // Credit unused tokens to withdrawable
        if (avail0 > used0) withdrawable[pos.owner].amount0 += avail0 - used0;
        if (avail1 > used1) withdrawable[pos.owner].amount1 += avail1 - used1;

        // Update position state
        pos.tickLower = newTickLower;
        pos.tickUpper = newTickUpper;
        pos.liquidity = newLiquidity;
        pos.entrySqrtPriceX96 = currentSqrtPrice;

        emit PositionAdjusted(positionId, 1, newTickLower, newTickUpper);
    }

    // ══════════════════════════════════════════════════════════════════════
    //                    EXIT / WITHDRAWAL
    // ══════════════════════════════════════════════════════════════════════

    function _enforceExit(uint256 positionId, uint256 removePct) internal {
        Position storage pos = _positions[positionId];
        if (!pos.active) return;

        uint128 liquidityToRemove;
        if (removePct >= 100) {
            liquidityToRemove = pos.liquidity;
        } else {
            liquidityToRemove = uint128((uint256(pos.liquidity) * removePct) / 100);
        }
        if (liquidityToRemove == 0) return;

        pos.liquidity -= liquidityToRemove;

        BalanceDelta delta = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData({
                    action: CallbackAction.REMOVE_LIQUIDITY,
                    sender: pos.owner,
                    key: pos.poolKey,
                    tickLower: pos.tickLower,
                    tickUpper: pos.tickUpper,
                    liquidityDelta: -int256(uint256(liquidityToRemove)),
                    positionId: positionId
                }))
            ),
            (BalanceDelta)
        );

        if (delta.amount0() > 0) {
            withdrawable[pos.owner].amount0 += uint256(uint128(delta.amount0()));
        }
        if (delta.amount1() > 0) {
            withdrawable[pos.owner].amount1 += uint256(uint128(delta.amount1()));
        }

        if (pos.liquidity == 0) {
            pos.active = false;
            emit PositionExited(positionId);
        }
    }

    function manualExit(uint256 positionId) external {
        Position storage pos = _positions[positionId];
        if (pos.owner != msg.sender) revert OnlyPositionOwner();
        if (!pos.active) revert PositionNotActive();

        _enforceExit(positionId, 100);
        _removeFromActiveList(activePositionIndex[positionId]);
    }

    function withdraw(Currency currency) external {
        WithdrawableBalance storage bal = withdrawable[msg.sender];
        if (bal.amount0 == 0 && bal.amount1 == 0) revert NothingToWithdraw();

        uint256 amt0 = bal.amount0;
        uint256 amt1 = bal.amount1;
        bal.amount0 = 0;
        bal.amount1 = 0;

        if (amt0 > 0 && !currency.isAddressZero()) {
            IERC20Minimal(Currency.unwrap(currency)).transfer(msg.sender, amt0);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //                        VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════

    function getPosition(uint256 positionId) external view returns (
        address owner, bool active, uint128 liquidity, int24 tickLower, int24 tickUpper,
        uint160 entrySqrtPriceX96, int256 delta, uint256 gamma, uint256 theta, uint256 vega
    ) {
        Position storage pos = _positions[positionId];
        return (pos.owner, pos.active, pos.liquidity, pos.tickLower, pos.tickUpper,
                pos.entrySqrtPriceX96, pos.delta, pos.gamma, pos.theta, pos.vega);
    }

    function getGreekProfile(uint256 positionId) external view returns (GreekProfile memory) {
        return _positions[positionId].profile;
    }

    function activePositionCount() external view returns (uint256) {
        return activePositionIds.length;
    }

    function getWithdrawable(address user) external view returns (uint256 amount0, uint256 amount1) {
        WithdrawableBalance storage bal = withdrawable[user];
        return (bal.amount0, bal.amount1);
    }

    function getSnapshotCount(PoolId poolId) external view returns (uint256) {
        return snapshotCount[poolId];
    }

    // ══════════════════════════════════════════════════════════════════════
    //                       INTERNAL HELPERS
    // ══════════════════════════════════════════════════════════════════════

    function _computeMaxLiquidity(
        uint256 avail0,
        uint256 avail1,
        uint160 sqrtPriceX96,
        int24 newTickLower,
        int24 newTickUpper
    ) internal view returns (uint128) {
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(newTickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(newTickUpper);

        if (sqrtPriceX96 <= sqrtLower) {
            // Only token0 needed
            uint256 diff = uint256(sqrtUpper) - uint256(sqrtLower);
            if (diff == 0) return 0;
            uint256 L = (avail0 * uint256(sqrtLower) >> 96) * uint256(sqrtUpper) / diff;
            return uint128(_min256(L, type(uint128).max));
        } else if (sqrtPriceX96 >= sqrtUpper) {
            // Only token1 needed
            uint256 diff = uint256(sqrtUpper) - uint256(sqrtLower);
            if (diff == 0) return 0;
            uint256 L = (avail1 << 96) / diff;
            return uint128(_min256(L, type(uint128).max));
        } else {
            // Both tokens needed — take the minimum
            uint256 L0;
            {
                uint256 diff0 = uint256(sqrtUpper) - uint256(sqrtPriceX96);
                if (diff0 == 0) return 0;
                L0 = (avail0 * uint256(sqrtPriceX96) >> 96) * uint256(sqrtUpper) / diff0;
            }
            uint256 L1;
            {
                uint256 diff1 = uint256(sqrtPriceX96) - uint256(sqrtLower);
                if (diff1 == 0) return 0;
                L1 = (avail1 << 96) / diff1;
            }
            return uint128(_min256(_min256(L0, L1), type(uint128).max));
        }
    }

    function _updateInventoryOnDeposit(
        PoolId poolId, uint160 sqrtPriceX96,
        int24 tickLower, int24 tickUpper, uint128 liquidityAmount
    ) internal {
        PoolInventory storage inv = poolInventory[poolId];
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);

        uint256 amount0;
        uint256 amount1;

        if (sqrtPriceX96 <= sqrtLower) {
            amount0 = uint256(liquidityAmount);
        } else if (sqrtPriceX96 >= sqrtUpper) {
            amount1 = uint256(liquidityAmount);
        } else {
            uint256 range = uint256(sqrtUpper) - uint256(sqrtLower);
            amount0 = (uint256(liquidityAmount) * (uint256(sqrtUpper) - uint256(sqrtPriceX96))) / range;
            amount1 = (uint256(liquidityAmount) * (uint256(sqrtPriceX96) - uint256(sqrtLower))) / range;
        }

        inv.totalToken0 += amount0;
        inv.totalToken1 += amount1;
    }

    function _removeFromActiveList(uint256 index) internal {
        uint256 lastIndex = activePositionIds.length - 1;
        if (index != lastIndex) {
            uint256 lastPosId = activePositionIds[lastIndex];
            activePositionIds[index] = lastPosId;
            activePositionIndex[lastPosId] = index;
        }
        activePositionIds.pop();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    function _min256(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    receive() external payable override(AbstractPayer) {}
}
