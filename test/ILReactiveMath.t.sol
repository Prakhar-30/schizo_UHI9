// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IReactive} from "reactive-lib/src/interfaces/IReactive.sol";
import {ILReactiveHarness} from "./harness/ILReactiveHarness.sol";
import {ILBondReactive} from "../src/ILBondReactive.sol";

contract ILReactiveMathTest is Test {
    ILReactiveHarness rx;

    uint256 constant BPS = 10000;
    uint160 MIN_SP = TickMath.MIN_SQRT_PRICE;
    uint160 MAX_SP = TickMath.MAX_SQRT_PRICE;

    // topics (arbitrary, non-zero)
    uint256 constant SWAP_TOPIC = uint256(keccak256("SwapOccurred"));
    uint256 constant CREATED_TOPIC = uint256(keccak256("PositionCreated"));
    uint256 constant EXITED_TOPIC = uint256(keccak256("PositionExited"));
    uint256 constant BUNDLE_TOPIC = uint256(keccak256("ILBondDataBundle"));
    bytes32 constant CALLBACK_SIG = keccak256("Callback(uint256,address,uint64,bytes)");

    function setUp() public {
        rx = new ILReactiveHarness(
            address(this), address(0xCAFE), 11155111, SWAP_TOPIC, CREATED_TOPIC, EXITED_TOPIC, BUNDLE_TOPIC
        );
    }

    function _il(uint160 entry, uint160 cur, uint128 liq) internal view returns (int256 ilBps, uint256 mark) {
        return rx.exposed_computeILMark(0, entry, cur, liq);
    }

    // ── Property fuzzing over the full valid sqrt-price range ─────────────────

    function testFuzz_ilMark_properties(uint160 entry, uint160 cur, uint128 liq) public view {
        entry = uint160(bound(entry, MIN_SP, MAX_SP));
        cur = uint160(bound(cur, MIN_SP, MAX_SP));

        (int256 ilBps, uint256 mark) = _il(entry, cur, liq);

        // IL is a loss (or zero) for the IL-T holder — never positive.
        assertLe(ilBps, int256(0), "ilBps must be <= 0");
        // Magnitude can never exceed 100%.
        assertGe(ilBps, -int256(BPS), "ilBps must be >= -10000");
        // Mark is a fraction of liquidity, never more.
        assertLe(mark, uint256(liq), "mark <= liquidity");
        // Mark is exactly liquidity * (1 - IL).
        uint256 ilMag = uint256(-ilBps);
        assertEq(mark, uint256(liq) * (BPS - ilMag) / BPS, "mark formula consistency");
    }

    function testFuzz_ilMark_neverReverts_extremeRange(uint160 entry, uint160 cur) public view {
        // Even at the extremes of the valid range it must not revert (overflow guard).
        entry = uint160(bound(entry, MIN_SP, MAX_SP));
        cur = uint160(bound(cur, MIN_SP, MAX_SP));
        _il(entry, cur, 1e18); // just must not revert
    }

    // ── Specific known points ────────────────────────────────────────────────

    function test_ilMark_zeroAtParity() public view {
        (int256 ilBps, uint256 mark) = _il(1e18 * 1e9, 1e18 * 1e9, 5e18);
        assertEq(ilBps, 0, "no IL at parity");
        assertEq(mark, 5e18, "mark == liquidity at parity");
    }

    function test_ilMark_zeroInputs() public view {
        (int256 a, uint256 am) = _il(0, 1e27, 5e18);
        (int256 b, uint256 bm) = _il(1e27, 0, 5e18);
        (int256 c, uint256 cm) = _il(1e27, 1e27, 0);
        assertEq(a, 0); assertEq(am, 0);
        assertEq(b, 0); assertEq(bm, 0);
        assertEq(c, 0); assertEq(cm, 0);
    }

    function test_ilMark_extremesSaturate() public view {
        // Max divergence: should saturate at -100% IL and zero mark, NOT revert.
        (int256 ilHi, uint256 markHi) = _il(MIN_SP, MAX_SP, 9e18);
        assertEq(ilHi, -int256(BPS), "saturates to -100%");
        assertEq(markHi, 0, "mark zero at full IL");

        (int256 ilLo, uint256 markLo) = _il(MAX_SP, MIN_SP, 9e18);
        assertEq(ilLo, -int256(BPS), "saturates the other direction too");
        assertEq(markLo, 0);
    }

    function test_ilMark_symmetry() public view {
        // IL(r) == IL(1/r): swapping entry/current yields equal magnitude.
        uint160 a = uint160(1e18 * 1e9);
        uint160 b = uint160(15e17 * 1e9); // 1.5x
        (int256 il1,) = _il(a, b, 1e18);
        (int256 il2,) = _il(b, a, 1e18);
        assertApproxEqAbs(il1, il2, 2, "symmetric within rounding");
    }

    function test_ilMark_monotonic() public view {
        uint160 entry = uint160(1e18 * 1e9);
        (int256 near,) = _il(entry, uint160(11e17 * 1e9), 1e18); // 1.1x
        (int256 far,) = _il(entry, uint160(3e18 * 1e9), 1e18);   // 3x
        // farther from parity => more negative (bigger loss)
        assertLt(far, near, "more divergence => more IL");
    }

    function testFuzz_ilMark_monotonic(uint160 entry, uint256 d1, uint256 d2) public view {
        entry = uint160(bound(entry, 1e18, 1e30));
        d1 = bound(d1, 1, 1e6);
        d2 = bound(d2, d1 + 1, d1 + 1e9); // d2 strictly farther up
        uint160 cur1 = uint160(bound(uint256(entry) + d1, MIN_SP, MAX_SP));
        uint160 cur2 = uint160(bound(uint256(entry) + d2, uint256(cur1), MAX_SP));
        vm.assume(cur2 > cur1);
        (int256 il1,) = _il(entry, cur1, 1e18);
        (int256 il2,) = _il(entry, cur2, 1e18);
        assertLe(il2, il1, "monotonic: farther up => >= IL");
    }

    // ── End-to-end react() bundle path ───────────────────────────────────────

    function _bundleLog(ILBondReactive.PositionData[] memory pts)
        internal
        pure
        returns (IReactive.LogRecord memory log)
    {
        bytes memory inner = abi.encode(pts); // == hook's `pkg`
        log = IReactive.LogRecord({
            chain_id: 11155111,
            _contract: address(0xCAFE),
            topic_0: BUNDLE_TOPIC,
            topic_1: 0,
            topic_2: 0,
            topic_3: 0,
            data: abi.encode(inner), // event's bytes-data encoding
            block_number: 1,
            op_code: 0,
            block_hash: 0,
            tx_hash: 0,
            log_index: 0
        });
    }

    function test_react_emitsSettleCallbackPerPosition() public {
        ILBondReactive.PositionData[] memory pts = new ILBondReactive.PositionData[](2);
        pts[0] = ILBondReactive.PositionData(7, uint160(1e18 * 1e9), uint160(15e17 * 1e9), 0, 0, 3e18);
        pts[1] = ILBondReactive.PositionData(9, uint160(2e18 * 1e9), uint160(2e18 * 1e9), 0, 0, 4e18);

        vm.recordLogs();
        rx.react(_bundleLog(pts));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 callbacks;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != CALLBACK_SIG) continue;
            bytes memory payload = abi.decode(logs[i].data, (bytes));

            // Recompute the expected mark for this position and assert the exact
            // settleILMark payload the RSC produced matches.
            uint256 pid = callbacks == 0 ? 7 : 9;
            (int256 ilBps, uint256 mark) = rx.exposed_computeILMark(pts[callbacks]);
            bytes memory expected = abi.encodeWithSignature(
                "settleILMark(address,uint256,int256,uint256)", address(0), pid, ilBps, mark
            );
            assertEq(payload, expected, "callback payload matches computed mark");
            callbacks++;
        }
        assertEq(callbacks, 2, "one settle callback per position");
    }

    function test_react_swapTriggersPrepareBundle() public {
        IReactive.LogRecord memory log = _bundleLog(new ILBondReactive.PositionData[](0));
        log.topic_0 = SWAP_TOPIC;

        vm.recordLogs();
        rx.react(log);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != CALLBACK_SIG) continue;
            bytes memory payload = abi.decode(logs[i].data, (bytes));
            if (bytes4(payload) == bytes4(keccak256("prepareILBondData(address)"))) found = true;
        }
        assertTrue(found, "swap should relay a prepareILBondData callback");
    }
}
