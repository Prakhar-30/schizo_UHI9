// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "reactive-lib/src/interfaces/IReactive.sol";
import "reactive-lib/src/abstract-base/AbstractPausableReactive.sol";

/// @title GreeksLPReactive — Options-Greeks Computation Engine
/// @notice Deployed on Reactive Network. Subscribes to hook events, computes
///         realized volatility and position Greeks (delta, gamma, theta, vega),
///         and emits action callbacks to reposition or exit LP positions.
///
///         Two-phase architecture:
///         Phase 1: Cron → callback to hook.prepareGreeksData() → hook emits GreeksDataBundle
///         Phase 2: react() sees GreeksDataBundle → computes Greeks → callback actions to hook
contract GreeksLPReactive is IReactive, AbstractPausableReactive {

    // ══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ══════════════════════════════════════════════════════════════════════

    event CallbackSent(string indexed action);
    event PositionTracked(uint256 indexed positionId);
    event PositionRemoved(uint256 indexed positionId);

    // ══════════════════════════════════════════════════════════════════════
    //                            CONSTANTS
    // ══════════════════════════════════════════════════════════════════════

    /// @dev Cron100 — fires every 100 blocks (~12 minutes)
    uint256 private constant CRON_TOPIC =
        0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70;

    uint64 private constant CALLBACK_GAS_LIMIT = 4_000_000;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    // ══════════════════════════════════════════════════════════════════════
    //                           IMMUTABLES
    // ══════════════════════════════════════════════════════════════════════

    address public immutable callbackContract;
    uint256 public immutable destChainId;

    // Topic hashes stored as immutables so react() can compare directly
    uint256 public immutable positionCreatedTopic;
    uint256 public immutable positionExitedTopic;
    uint256 public immutable greeksDataBundleTopic;

    // ══════════════════════════════════════════════════════════════════════
    //                          MUTABLE STATE
    //  (written by callbackOnly — INVISIBLE to react())
    // ══════════════════════════════════════════════════════════════════════

    uint256 public activeCount;
    bool public cronSubscribed;

    // ══════════════════════════════════════════════════════════════════════
    //            SHARED STRUCT — must match GreeksLPHook.PositionData
    // ══════════════════════════════════════════════════════════════════════

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

    // ══════════════════════════════════════════════════════════════════════
    //                          CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════════

    constructor(
        address _owner,
        address _callbackContract,
        uint256 _destChainId,
        uint256 _positionCreatedTopic,
        uint256 _positionExitedTopic,
        uint256 _greeksDataBundleTopic
    ) payable {
        owner = _owner;
        callbackContract = _callbackContract;
        destChainId = _destChainId;
        positionCreatedTopic = _positionCreatedTopic;
        positionExitedTopic = _positionExitedTopic;
        greeksDataBundleTopic = _greeksDataBundleTopic;

        if (!vm) {
            // Subscribe to PositionCreated events from hook
            service.subscribe(
                _destChainId,
                _callbackContract,
                _positionCreatedTopic,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );

            // Subscribe to PositionExited events from hook
            service.subscribe(
                _destChainId,
                _callbackContract,
                _positionExitedTopic,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );

            // Subscribe to GreeksDataBundle events from hook
            // (emitted in response to our prepareGreeksData callback)
            service.subscribe(
                _destChainId,
                _callbackContract,
                _greeksDataBundleTopic,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //                          react()
    //  Runs in ReactVM. No state writes. Only emit Callback.
    // ══════════════════════════════════════════════════════════════════════

    function react(LogRecord calldata log) external vmOnly {
        // 1. Cron tick → trigger data preparation on hook
        if (log.topic_0 == CRON_TOPIC) {
            _handleCronTick();
            return;
        }

        // 2. GreeksDataBundle → heavy computation + action callbacks
        if (log.topic_0 == greeksDataBundleTopic) {
            _processGreeksDataBundle(log);
            return;
        }

        // 3. PositionCreated → self-callback to manage lifecycle
        if (log.topic_0 == positionCreatedTopic) {
            uint256 positionId = log.topic_1;
            emit Callback(
                block.chainid,
                address(this),
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature(
                    "persistPositionCreated(address,uint256)",
                    address(0),
                    positionId
                )
            );
            return;
        }

        // 4. PositionExited → self-callback to manage lifecycle
        if (log.topic_0 == positionExitedTopic) {
            uint256 positionId = log.topic_1;
            emit Callback(
                block.chainid,
                address(this),
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature(
                    "persistPositionExited(address,uint256)",
                    address(0),
                    positionId
                )
            );
            return;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //                         CRON HANDLER
    // ══════════════════════════════════════════════════════════════════════

    function _handleCronTick() internal {
        // Phase 1: Ask hook to prepare and emit data bundle
        emit Callback(
            destChainId,
            callbackContract,
            CALLBACK_GAS_LIMIT,
            abi.encodeWithSignature(
                "prepareGreeksData(address)",
                address(0)
            )
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    //          PHASE 2: GREEKS COMPUTATION (runs in ReactVM)
    // ══════════════════════════════════════════════════════════════════════

    function _processGreeksDataBundle(LogRecord calldata log) internal {
        // Decode outer bytes wrapper (event non-indexed param)
        bytes memory fullData = abi.decode(log.data, (bytes));

        // Decode three sub-bundles
        (bytes memory priceData, bytes memory posData, bytes memory metricsData) =
            abi.decode(fullData, (bytes, bytes, bytes));

        // Decode price history
        (uint160[] memory sqrtPrices, uint256[] memory timestamps) =
            abi.decode(priceData, (uint160[], uint256[]));

        // Decode positions
        PositionData[] memory positions = abi.decode(posData, (PositionData[]));

        // Decode metrics
        (uint256 totalLiquidity, uint256 swapVolume, uint256 timeDelta, int24 tickSpacing) =
            abi.decode(metricsData, (uint256, uint256, uint256, int24));

        // Compute realized volatility from price snapshots
        uint256 realizedVol = _computeRealizedVol(sqrtPrices, timestamps);

        // Get current price (latest snapshot)
        uint160 currentSqrtPrice = sqrtPrices.length > 0
            ? sqrtPrices[sqrtPrices.length - 1]
            : uint160(0);

        if (currentSqrtPrice == 0) return;

        // Process each position: compute Greeks, check thresholds, emit actions
        for (uint256 i = 0; i < positions.length; i++) {
            _processPosition(
                positions[i],
                currentSqrtPrice,
                realizedVol,
                totalLiquidity,
                swapVolume,
                timeDelta,
                tickSpacing
            );
        }
    }

    function _processPosition(
        PositionData memory pos,
        uint160 currentSqrtPrice,
        uint256 realizedVol,
        uint256 totalLiquidity,
        uint256 swapVolume,
        uint256 timeDelta,
        int24 tickSpacing
    ) internal {
        // Compute all four Greeks
        int256 delta = _computeDelta(currentSqrtPrice, pos);
        uint256 gamma = _computeGamma(pos.entrySqrtPriceX96, currentSqrtPrice);
        uint256 theta = _computeTheta(pos.liquidity, totalLiquidity, swapVolume, timeDelta);
        uint256 vega = _computeVega(gamma, realizedVol);

        // Always update Greeks on the hook (for monitoring/UI)
        emit Callback(
            destChainId,
            callbackContract,
            CALLBACK_GAS_LIMIT,
            abi.encodeWithSignature(
                "updateGreeks(address,uint256,int256,uint256,uint256,uint256)",
                address(0),
                pos.posId,
                delta,
                gamma,
                theta,
                vega
            )
        );

        // Determine if action is needed
        uint8 action = _determineAction(delta, gamma, theta, vega, pos);

        if (action > 0) {
            (int24 newTickLower, int24 newTickUpper) = _computeNewRange(
                pos, action, tickSpacing
            );

            emit Callback(
                destChainId,
                callbackContract,
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature(
                    "executeAction(address,uint256,uint8,int24,int24)",
                    address(0),
                    pos.posId,
                    action,
                    newTickLower,
                    newTickUpper
                )
            );
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //                  GREEKS COMPUTATION ENGINE
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Realized volatility from price snapshots using Pade log-return approximation
    /// @return vol Annualized volatility in 1e18 (1e18 = 100%)
    function _computeRealizedVol(
        uint160[] memory sqrtPrices,
        uint256[] memory timestamps
    ) internal pure returns (uint256) {
        uint256 n = sqrtPrices.length;
        if (n < 3) return 0;

        uint256 sumSquaredReturns = 0;
        uint256 validCount = 0;

        for (uint256 i = 1; i < n; i++) {
            uint256 prev = uint256(sqrtPrices[i - 1]);
            uint256 curr = uint256(sqrtPrices[i]);
            if (prev == 0 || curr == 0) continue;

            // ln(price_ratio) ≈ 4 * (sqrtP_curr - sqrtP_prev) / (sqrtP_curr + sqrtP_prev)
            // Using Pade approximation for ln(x^2) = 2*ln(x) ≈ 4*(x-1)/(x+1) where x = curr/prev
            int256 diff = int256(curr) - int256(prev);
            uint256 sum = curr + prev;

            // logReturn in 1e18 precision
            int256 logReturn = (4 * diff * int256(PRECISION)) / int256(sum);

            // Accumulate squared returns (assuming mean ≈ 0 for short periods)
            // logReturn^2 / PRECISION to keep in 1e18
            uint256 squared = uint256(logReturn >= 0 ? logReturn : -logReturn);
            squared = squared * squared / PRECISION;
            sumSquaredReturns += squared;
            validCount++;
        }

        if (validCount < 2) return 0;

        // Variance per observation = sumSquaredReturns / validCount
        uint256 variance = sumSquaredReturns / validCount;

        // Annualize: variance_annual = variance * (SECONDS_PER_YEAR / avg_seconds_between_obs)
        uint256 totalTime = timestamps[n - 1] - timestamps[0];
        if (totalTime == 0) return 0;

        uint256 avgObsTime = totalTime / validCount;
        if (avgObsTime == 0) return 0;

        uint256 annualVariance = variance * SECONDS_PER_YEAR / avgObsTime;

        // vol = sqrt(annualVariance)
        return _sqrt(annualVariance);
    }

    /// @notice Delta: directional exposure as BPS (-10000 to +10000)
    ///         Positive = overweight token0, Negative = overweight token1
    function _computeDelta(
        uint160 currentSqrtPrice,
        PositionData memory pos
    ) internal pure returns (int256) {
        if (currentSqrtPrice <= pos.sqrtPriceLower) {
            return int256(BPS); // All token0 — max positive delta
        }
        if (currentSqrtPrice >= pos.sqrtPriceUpper) {
            return -int256(BPS); // All token1 — max negative delta
        }

        // In range: compute value-weighted directional exposure
        // value0 (in token1 terms) ∝ sqrtP * (sqrtPU - sqrtP) / sqrtPU
        // value1 (in token1 terms) ∝ (sqrtP - sqrtPL)
        uint256 sqrtP = uint256(currentSqrtPrice);
        uint256 sqrtPL = uint256(pos.sqrtPriceLower);
        uint256 sqrtPU = uint256(pos.sqrtPriceUpper);

        uint256 value0 = sqrtP * (sqrtPU - sqrtP) / sqrtPU;
        uint256 value1 = sqrtP - sqrtPL;

        uint256 total = value0 + value1;
        if (total == 0) return 0;

        // delta_bps = (value0 - value1) / total * 10000
        if (value0 >= value1) {
            return int256((value0 - value1) * BPS / total);
        } else {
            return -int256((value1 - value0) * BPS / total);
        }
    }

    /// @notice Gamma: IL acceleration — BPS of IL gained per 1% price move
    ///         Computed by finite difference: IL(price+1%) - IL(price)
    function _computeGamma(
        uint160 entrySqrtPrice,
        uint160 currentSqrtPrice
    ) internal pure returns (uint256) {
        uint256 entry = uint256(entrySqrtPrice);
        uint256 current = uint256(currentSqrtPrice);
        if (entry == 0 || current == 0) return 0;

        // IL at current price
        uint256 ilNow = _computeILBps(entry, current);

        // IL at price + 1%: sqrtPrice * sqrt(1.01) ≈ sqrtPrice * 1005/1000
        uint256 currentPlus1Pct = current * 1005 / 1000;
        uint256 ilPlus = _computeILBps(entry, currentPlus1Pct);

        // IL at price - 1%: sqrtPrice * sqrt(0.99) ≈ sqrtPrice * 995/1000
        uint256 currentMinus1Pct = current * 995 / 1000;
        uint256 ilMinus = _computeILBps(entry, currentMinus1Pct);

        // Gamma = max(IL_+1% - IL_now, IL_-1% - IL_now) — worst-case directional sensitivity
        uint256 gammaUp = ilPlus > ilNow ? ilPlus - ilNow : 0;
        uint256 gammaDn = ilMinus > ilNow ? ilMinus - ilNow : 0;

        return gammaUp > gammaDn ? gammaUp : gammaDn;
    }

    /// @notice Theta: annualized fee yield in BPS
    ///         theta = (swapVolume * feeRate * posShare) / posValue * annualization
    function _computeTheta(
        uint128 posLiquidity,
        uint256 totalLiquidity,
        uint256 swapVolume,
        uint256 timeDelta
    ) internal pure returns (uint256) {
        if (totalLiquidity == 0 || timeDelta == 0 || posLiquidity == 0) return 0;

        // Total fees ≈ swapVolume * 30 bps (0.3% base fee)
        uint256 totalFees = swapVolume * 30 / BPS;

        // Position's share of fees
        uint256 posFees = totalFees * uint256(posLiquidity) / totalLiquidity;

        // Annualized yield in BPS relative to position liquidity
        // theta = (posFees / posLiquidity) * (SECONDS_PER_YEAR / timeDelta) * BPS
        uint256 posValue = uint256(posLiquidity);

        // Avoid overflow: compute step by step
        uint256 yieldPerPeriod = posFees * BPS / posValue; // yield in BPS for this period
        uint256 annualized = yieldPerPeriod * SECONDS_PER_YEAR / timeDelta;

        return annualized;
    }

    /// @notice Vega: sensitivity to volatility changes
    ///         vega ≈ gamma * realizedVol — higher gamma + higher vol = more risk
    function _computeVega(
        uint256 gammaBps,
        uint256 realizedVol
    ) internal pure returns (uint256) {
        // vegaBps = gammaBps * realizedVol / PRECISION
        return gammaBps * realizedVol / PRECISION;
    }

    /// @notice Standard IL formula: IL = 1 - 2*sqrt(r)/(1+r) where r = (currentP/entryP)
    function _computeILBps(
        uint256 entrySqrtPrice,
        uint256 currentSqrtPrice
    ) internal pure returns (uint256) {
        if (entrySqrtPrice == 0) return 0;

        uint256 sqrtR = currentSqrtPrice * PRECISION / entrySqrtPrice;
        uint256 r = sqrtR * sqrtR / PRECISION;

        uint256 numerator = 2 * sqrtR * BPS;
        uint256 denominator = PRECISION + r;
        if (denominator == 0) return 0;

        uint256 ratio = numerator / denominator;
        return ratio >= BPS ? 0 : BPS - ratio;
    }

    // ══════════════════════════════════════════════════════════════════════
    //                   ACTION DETERMINATION
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Determine what action to take based on Greek thresholds
    /// @return action 0=NONE, 1=WIDEN, 3=SHIFT_UP, 4=SHIFT_DOWN, 5=PARTIAL_EXIT, 6=FULL_EXIT
    function _determineAction(
        int256 delta,
        uint256 gamma,
        uint256 theta,
        uint256 vega,
        PositionData memory pos
    ) internal pure returns (uint8) {
        // Priority 1: Gamma check — if gamma exceeds max, widen the range
        if (gamma > pos.maxGammaBps) {
            // If gamma is extremely high (>2x limit), exit instead
            if (gamma > pos.maxGammaBps * 2) {
                return 6; // FULL_EXIT
            }
            return 1; // WIDEN
        }

        // Priority 2: Delta check — if |delta| exceeds tolerance, shift range
        uint256 absDelta = delta >= 0 ? uint256(delta) : uint256(-delta);
        if (absDelta > pos.maxDeltaBps) {
            // Positive delta = too much token0 = price below center → shift down to follow
            // Negative delta = too much token1 = price above center → shift up to follow
            return delta > 0 ? 4 : 3; // SHIFT_DOWN or SHIFT_UP
        }

        // Priority 3: Theta/Gamma ratio — are fees compensating for IL risk?
        if (gamma > 0 && pos.minThetaGammaRatio > 0) {
            uint256 ratio = theta * PRECISION / gamma;
            if (ratio < pos.minThetaGammaRatio) {
                // Fees are NOT compensating for IL risk
                if (theta < 50) {
                    // Very low fee income — not worth the risk
                    return 6; // FULL_EXIT
                }
                // Moderate: widen to reduce gamma (improves ratio)
                return 1; // WIDEN
            }
        }

        // Priority 4: Vega — vol regime change
        // If vega is significant and gamma is already concerning (>50% of max)
        if (vega > 0 && gamma > pos.maxGammaBps / 2) {
            return pos.vegaAction; // User-configured: 1=WIDEN, 6=EXIT, 0=NOTHING
        }

        return 0; // No action needed
    }

    // ══════════════════════════════════════════════════════════════════════
    //                   RANGE COMPUTATION
    // ══════════════════════════════════════════════════════════════════════

    function _computeNewRange(
        PositionData memory pos,
        uint8 action,
        int24 tickSpacing
    ) internal pure returns (int24 newTickLower, int24 newTickUpper) {
        int24 widthAdjust = tickSpacing * 4;
        int24 shiftAmount = tickSpacing * 6;

        if (action == 1) {
            // WIDEN — expand both sides
            newTickLower = pos.tickLower - widthAdjust;
            newTickUpper = pos.tickUpper + widthAdjust;
        } else if (action == 3) {
            // SHIFT_UP — move range higher
            newTickLower = pos.tickLower + shiftAmount;
            newTickUpper = pos.tickUpper + shiftAmount;
        } else if (action == 4) {
            // SHIFT_DOWN — move range lower
            newTickLower = pos.tickLower - shiftAmount;
            newTickUpper = pos.tickUpper - shiftAmount;
        } else {
            // No range change (EXIT actions don't need new range)
            newTickLower = pos.tickLower;
            newTickUpper = pos.tickUpper;
        }

        // Align to tick spacing
        newTickLower = (newTickLower / tickSpacing) * tickSpacing;
        newTickUpper = (newTickUpper / tickSpacing) * tickSpacing;

        // Clamp to valid tick range
        int24 MIN_TICK = -887220;
        int24 MAX_TICK = 887220;
        if (newTickLower < MIN_TICK) newTickLower = MIN_TICK;
        if (newTickUpper > MAX_TICK) newTickUpper = MAX_TICK;

        // Ensure minimum width
        if (newTickUpper - newTickLower < tickSpacing * 2) {
            newTickLower = pos.tickLower;
            newTickUpper = pos.tickUpper;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //              STATE PERSISTENCE (callbackOnly)
    // ══════════════════════════════════════════════════════════════════════

    modifier callbackOnly() {
        require(
            msg.sender == address(0x0000000000000000000000000000000000fffFfF),
            "Callback proxy only"
        );
        _;
    }

    function persistPositionCreated(
        address /* _sender */,
        uint256 positionId
    ) external callbackOnly {
        activeCount++;
        emit PositionTracked(positionId);

        // Subscribe to cron when first active position arrives
        if (activeCount == 1 && !cronSubscribed) {
            service.subscribe(
                block.chainid,
                address(service),
                CRON_TOPIC,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
            cronSubscribed = true;
        }
    }

    function persistPositionExited(
        address /* _sender */,
        uint256 positionId
    ) external callbackOnly {
        if (activeCount > 0) {
            activeCount--;
        }
        emit PositionRemoved(positionId);

        // Unsubscribe from cron when no more active positions
        if (activeCount == 0 && cronSubscribed) {
            service.unsubscribe(
                block.chainid,
                address(service),
                CRON_TOPIC,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
            cronSubscribed = false;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //                   PAUSABLE SUBSCRIPTIONS
    // ══════════════════════════════════════════════════════════════════════

    function getPausableSubscriptions()
        internal
        view
        override
        returns (Subscription[] memory)
    {
        if (!cronSubscribed) return new Subscription[](0);

        Subscription[] memory subs = new Subscription[](1);
        subs[0] = Subscription(
            block.chainid,
            address(service),
            CRON_TOPIC,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        return subs;
    }

    // ══════════════════════════════════════════════════════════════════════
    //                       MATH HELPERS
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Babylonian integer square root
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
