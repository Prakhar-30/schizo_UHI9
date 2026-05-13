// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "reactive-lib/src/interfaces/IReactive.sol";
import "reactive-lib/src/abstract-base/AbstractPausableReactive.sol";

/// @title CoveredLPReactive — Pricing & Lifecycle Engine for CoveredLPHook
/// @notice Subscribes to swap events (re-prices live options) + a hourly cron
///         (settles expired options). Pure compute happens in ReactVM.
contract CoveredLPReactive is IReactive, AbstractPausableReactive {

    // ── Events ─────────────────────────────────────────────────────────────
    event CallbackSent(string indexed action);
    event OptionTracked(uint256 indexed optionId);
    event OptionRemoved(uint256 indexed optionId);

    // ── Constants ──────────────────────────────────────────────────────────
    /// @dev Cron1000 — every 1000 blocks (~2 hours)
    uint256 private constant CRON_TOPIC =
        0xe20b31294d84c3661ddc8f423abb9c70310d0cf172aa2714ead78029b325e3f4;

    uint64 private constant CALLBACK_GAS_LIMIT = 4_000_000;
    uint256 private constant BPS = 10000;
    uint256 private constant PRECISION = 1e18;

    // ── Immutables ─────────────────────────────────────────────────────────
    address public immutable callbackContract;
    uint256 public immutable destChainId;

    uint256 public immutable swapTopic;
    uint256 public immutable positionCreatedTopic;
    uint256 public immutable positionExitedTopic;
    uint256 public immutable optionMintedTopic;
    uint256 public immutable optionPurchasedTopic;
    uint256 public immutable optionSettledTopic;
    uint256 public immutable coveredDataBundleTopic;

    // ── Mutable state (callbackOnly only) ──────────────────────────────────
    uint256 public activeCount;
    bool public cronSubscribed;

    struct OptionDataPoint {
        uint256 optionId;
        uint160 strikeSqrtPriceX96;
        uint64 expiry;
        uint256 currentAsk;
        uint256 notional;
        uint8 status;
    }

    constructor(
        address _owner,
        address _callbackContract,
        uint256 _destChainId,
        uint256 _swapTopic,
        uint256 _positionCreatedTopic,
        uint256 _positionExitedTopic,
        uint256 _optionMintedTopic,
        uint256 _optionPurchasedTopic,
        uint256 _optionSettledTopic,
        uint256 _coveredDataBundleTopic
    ) payable {
        owner = _owner;
        callbackContract = _callbackContract;
        destChainId = _destChainId;
        swapTopic = _swapTopic;
        positionCreatedTopic = _positionCreatedTopic;
        positionExitedTopic = _positionExitedTopic;
        optionMintedTopic = _optionMintedTopic;
        optionPurchasedTopic = _optionPurchasedTopic;
        optionSettledTopic = _optionSettledTopic;
        coveredDataBundleTopic = _coveredDataBundleTopic;

        if (!vm) {
            service.subscribe(_destChainId, _callbackContract, _swapTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _positionCreatedTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _positionExitedTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _optionMintedTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _optionPurchasedTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _optionSettledTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            service.subscribe(_destChainId, _callbackContract, _coveredDataBundleTopic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        }
    }

    // ── react() ────────────────────────────────────────────────────────────
    function react(LogRecord calldata log) external vmOnly {
        // Cron tick → trigger pricing/expiry cycle
        if (log.topic_0 == CRON_TOPIC) {
            emit Callback(
                destChainId,
                callbackContract,
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature("prepareCoveredData(address)", address(0))
            );
            return;
        }

        // Swap → trigger pricing cycle (premium re-mark on every swap)
        if (log.topic_0 == swapTopic) {
            emit Callback(
                destChainId,
                callbackContract,
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature("prepareCoveredData(address)", address(0))
            );
            return;
        }

        // Bundle → compute new premiums + settle expired
        if (log.topic_0 == coveredDataBundleTopic) {
            _processCoveredBundle(log);
            return;
        }

        // OptionMinted → track activeCount++
        if (log.topic_0 == optionMintedTopic) {
            uint256 optionId = log.topic_1;
            emit Callback(
                block.chainid,
                address(this),
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature("persistOptionAdded(address,uint256)", address(0), optionId)
            );
            return;
        }

        // OptionSettled → activeCount--
        if (log.topic_0 == optionSettledTopic) {
            uint256 optionId = log.topic_1;
            emit Callback(
                block.chainid,
                address(this),
                CALLBACK_GAS_LIMIT,
                abi.encodeWithSignature("persistOptionRemoved(address,uint256)", address(0), optionId)
            );
            return;
        }
    }

    // ── Compute premiums + settle expired in ReactVM ───────────────────────
    function _processCoveredBundle(LogRecord calldata log) internal {
        bytes memory raw = abi.decode(log.data, (bytes));
        (uint160 currentSqrt, uint64 nowTs, OptionDataPoint[] memory pts) =
            abi.decode(raw, (uint160, uint64, OptionDataPoint[]));

        for (uint256 i; i < pts.length; ++i) {
            OptionDataPoint memory p = pts[i];

            // Expired? trigger settlement
            if (nowTs >= p.expiry) {
                emit Callback(
                    destChainId,
                    callbackContract,
                    CALLBACK_GAS_LIMIT,
                    abi.encodeWithSignature("settleOption(address,uint256)", address(0), p.optionId)
                );
                continue;
            }

            // Re-price PENDING options (status==0) only
            if (p.status != 0) continue;

            // Premium model: distance-aware. Closer to strike → higher premium.
            // newAsk = notional × max(distanceFactor, floor) × timeFactor / scaling
            // Where distanceFactor = max(0, BPS - moneyness) and moneyness = strike/current in bps
            uint256 premium = _computePremium(currentSqrt, p.strikeSqrtPriceX96, p.expiry, nowTs, p.notional);

            // Only update if materially different (avoid spam)
            uint256 cur = p.currentAsk;
            uint256 diff = premium > cur ? premium - cur : cur - premium;
            if (cur == 0 || diff * BPS / (cur == 0 ? 1 : cur) > 200) { // > 2% change
                emit Callback(
                    destChainId,
                    callbackContract,
                    CALLBACK_GAS_LIMIT,
                    abi.encodeWithSignature("updateOptionPremium(address,uint256,uint256)", address(0), p.optionId, premium)
                );
            }
        }
    }

    function _computePremium(
        uint160 currentSqrt,
        uint160 strikeSqrt,
        uint64 expiry,
        uint64 nowTs,
        uint256 notional
    ) internal pure returns (uint256) {
        if (notional == 0 || expiry <= nowTs) return 0;

        // moneyness = (current/strike)² in BPS
        uint256 ratio = uint256(currentSqrt) * BPS / uint256(strikeSqrt);
        uint256 moneynessBps = ratio * ratio / BPS;

        // Distance: how far below strike (BPS-moneyness if OTM; bigger if deeper OTM)
        // ITM (current >= strike) → premium = max(intrinsic, time-value floor)
        uint256 intrinsicBps = moneynessBps > BPS ? (moneynessBps - BPS) : 0;

        // Time decay component: timeRemaining/30days × volProxyBps
        uint256 timeRem = expiry - nowTs;
        uint256 timeFactor = timeRem > 30 days ? PRECISION : (timeRem * PRECISION / 30 days);

        // Vol proxy (constant 50% APV → ~14% per 30 days → 1400 bps over 30d)
        uint256 volBps = 1400 * timeFactor / PRECISION;

        // OTM time-value: shrinks with distance
        // distanceFromStrike in BPS (how much below strike). If currentSqrt < strikeSqrt → distance > 0
        uint256 distBps = moneynessBps < BPS ? (BPS - moneynessBps) : 0;
        // Time-value premium: volBps × decay(distance)
        // decay = max(0, 1 - distBps/2000) — beyond 20% OTM, no time-value
        uint256 decay = distBps >= 2000 ? 0 : (PRECISION - distBps * PRECISION / 2000);
        uint256 timeValueBps = volBps * decay / PRECISION;

        uint256 totalBps = intrinsicBps + timeValueBps;
        // premium in token1 units: notional × totalBps / BPS (notional treated as token1-equivalent base)
        return notional * totalBps / BPS;
    }

    // ── State persistence ──────────────────────────────────────────────────

    modifier callbackOnly() {
        require(msg.sender == address(0x0000000000000000000000000000000000fffFfF), "Callback proxy only");
        _;
    }

    function persistOptionAdded(address /* sender */, uint256 optionId) external callbackOnly {
        activeCount++;
        emit OptionTracked(optionId);

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

    function persistOptionRemoved(address /* sender */, uint256 optionId) external callbackOnly {
        if (activeCount > 0) activeCount--;
        emit OptionRemoved(optionId);

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

    function getPausableSubscriptions()
        internal view override returns (Subscription[] memory)
    {
        if (!cronSubscribed) return new Subscription[](0);
        Subscription[] memory subs = new Subscription[](1);
        subs[0] = Subscription(block.chainid, address(service), CRON_TOPIC,
            REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        return subs;
    }
}
