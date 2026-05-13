// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "reactive-lib/src/interfaces/IReactive.sol";
import "reactive-lib/src/abstract-base/AbstractPausableReactive.sol";

/// @title ILBondReactive — IL Mark-to-Market Engine for ILBondHook
/// @notice Subscribes to swap + lifecycle events from ILBondHook. After every swap,
///         asks the hook to emit a data bundle, then computes IL for each open
///         position and posts the mark back via callback. Pure event-driven —
///         no cron, no keeper polling.
contract ILBondReactive is IReactive, AbstractPausableReactive {

    // ── Events ─────────────────────────────────────────────────────────────
    event CallbackSent(string indexed action);
    event PositionTracked(uint256 indexed positionId);
    event PositionRemoved(uint256 indexed positionId);

    // ── Constants ──────────────────────────────────────────────────────────
    uint64 private constant CALLBACK_GAS_LIMIT = 4_000_000;
    uint256 private constant BPS = 10000;
    uint256 private constant PRECISION = 1e18;

    // ── Immutables ─────────────────────────────────────────────────────────
    address public immutable callbackContract;
    uint256 public immutable destChainId;

    uint256 public immutable swapTopic;
    uint256 public immutable positionCreatedTopic;
    uint256 public immutable positionExitedTopic;
    uint256 public immutable ilBondDataBundleTopic;

    // ── Mutable state (callbackOnly only) ──────────────────────────────────
    uint256 public activeCount;

    // Bundle struct must mirror ILBondHook.PositionData
    struct PositionData {
        uint256 positionId;
        uint160 entrySqrtPriceX96;
        uint160 sqrtPriceLower;
        uint160 sqrtPriceUpper;
        uint128 liquidity;
    }

    constructor(
        address _owner,
        address _callbackContract,
        uint256 _destChainId,
        uint256 _swapTopic,
        uint256 _positionCreatedTopic,
        uint256 _positionExitedTopic,
        uint256 _ilBondDataBundleTopic
    ) payable {
        owner = _owner;
        callbackContract = _callbackContract;
        destChainId = _destChainId;
        swapTopic = _swapTopic;
        positionCreatedTopic = _positionCreatedTopic;
        positionExitedTopic = _positionExitedTopic;
        ilBondDataBundleTopic = _ilBondDataBundleTopic;

        if (!vm) {
            service.subscribe(_destChainId, _callbackContract, _swapTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _positionCreatedTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _positionExitedTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _ilBondDataBundleTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        }
    }

    // ── react() ────────────────────────────────────────────────────────────
    function react(LogRecord calldata log) external vmOnly {
        // Swap → trigger data bundle (only if we're tracking positions)
        if (log.topic_0 == swapTopic) {
            // Always relay — hook will short-circuit if no active positions
            emit Callback(
                destChainId,
                callbackContract,
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature("prepareILBondData(address)", address(0))
            );
            return;
        }

        // Bundle → compute IL marks + callback
        if (log.topic_0 == ilBondDataBundleTopic) {
            _processBundle(log);
            return;
        }

        // PositionCreated → activeCount++
        if (log.topic_0 == positionCreatedTopic) {
            uint256 positionId = log.topic_1;
            emit Callback(
                block.chainid,
                address(this),
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature("persistPositionAdded(address,uint256)", address(0), positionId)
            );
            return;
        }

        // PositionExited → activeCount--
        if (log.topic_0 == positionExitedTopic) {
            uint256 positionId = log.topic_1;
            emit Callback(
                block.chainid,
                address(this),
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature("persistPositionRemoved(address,uint256)", address(0), positionId)
            );
            return;
        }
    }

    // ── Compute IL marks in ReactVM ────────────────────────────────────────
    function _processBundle(LogRecord calldata log) internal {
        bytes memory raw = abi.decode(log.data, (bytes));
        (uint160 currentSqrt, PositionData[] memory pts) = abi.decode(raw, (uint160, PositionData[]));

        for (uint256 i; i < pts.length; ++i) {
            PositionData memory p = pts[i];
            (int256 ilBps, uint256 markValue) = _computeILMark(p, currentSqrt);

            emit Callback(
                destChainId,
                callbackContract,
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature(
                    "settleILMark(address,uint256,int256,uint256)",
                    address(0),
                    p.positionId,
                    ilBps,
                    markValue
                )
            );
        }
    }

    /// @notice Compute IL relative to entry price, returning signed BPS.
    ///         Negative means the position has lost value vs HODL → IL-T holder is "down".
    ///         Positive means the position has outperformed HODL (rare for v3-style positions).
    function _computeILMark(PositionData memory p, uint160 currentSqrt)
        internal pure returns (int256 ilBps, uint256 markValue)
    {
        if (p.entrySqrtPriceX96 == 0 || currentSqrt == 0 || p.liquidity == 0) {
            return (0, 0);
        }

        // Standard IL formula: IL = 1 - 2*sqrt(r)/(1+r)  where r = (currentP/entryP)
        uint256 sqrtR = uint256(currentSqrt) * PRECISION / uint256(p.entrySqrtPriceX96);
        uint256 r = sqrtR * sqrtR / PRECISION;
        uint256 num = 2 * sqrtR * BPS;
        uint256 denom = PRECISION + r;
        if (denom == 0) return (0, 0);
        uint256 ratio = num / denom;
        // IL is non-negative; ratio <= BPS in principle.
        uint256 ilMagnitude = ratio >= BPS ? 0 : (BPS - ratio);
        // IL-T holder bears the loss → mark is negative for them.
        ilBps = -int256(ilMagnitude);

        // markValue: scaled "current LP composition" estimator in liquidity units.
        // For the dashboard: mark = liquidity * (1 - IL) (token1-equivalent).
        markValue = uint256(p.liquidity) * (BPS - ilMagnitude) / BPS;
    }

    // ── State persistence ──────────────────────────────────────────────────

    modifier callbackOnly() {
        require(msg.sender == address(0x0000000000000000000000000000000000fffFfF), "Callback proxy only");
        _;
    }

    function persistPositionAdded(address /* sender */, uint256 positionId) external callbackOnly {
        activeCount++;
        emit PositionTracked(positionId);
    }

    function persistPositionRemoved(address /* sender */, uint256 positionId) external callbackOnly {
        if (activeCount > 0) activeCount--;
        emit PositionRemoved(positionId);
    }

    // No cron subscription — pause/resume only affects swap subscription which is
    // managed at construction. We expose an empty list since the only resource is
    // subscriptions established in constructor.
    function getPausableSubscriptions()
        internal pure override returns (Subscription[] memory)
    {
        return new Subscription[](0);
    }
}
