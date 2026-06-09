// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IReactive} from "reactive-lib/src/interfaces/IReactive.sol";
import {ILReactiveHarness} from "./harness/ILReactiveHarness.sol";
import {ILBondReactive} from "../src/ILBondReactive.sol";

/// @notice Lifecycle + access-control tests for ILBondReactive's react() router
///         and its callback-only state mutators (complements ILReactiveMath.t.sol,
///         which covers the IL math + the bundle settle path).
contract ILReactiveLifecycleTest is Test {
    ILReactiveHarness rx;

    uint256 constant SWAP_TOPIC = uint256(keccak256("SwapOccurred"));
    uint256 constant CREATED_TOPIC = uint256(keccak256("PositionCreated"));
    uint256 constant EXITED_TOPIC = uint256(keccak256("PositionExited"));
    uint256 constant BUNDLE_TOPIC = uint256(keccak256("ILBondDataBundle"));
    bytes32 constant CALLBACK_SIG = keccak256("Callback(uint256,address,uint64,bytes)");

    address constant CALLBACK_PROXY = 0x0000000000000000000000000000000000fffFfF;
    address constant CALLBACK_CONTRACT = address(0xCAFE);
    uint256 constant DEST_CHAIN = 11155111;

    function setUp() public {
        rx = new ILReactiveHarness(
            address(this), CALLBACK_CONTRACT, DEST_CHAIN, SWAP_TOPIC, CREATED_TOPIC, EXITED_TOPIC, BUNDLE_TOPIC
        );
    }

    function _log(uint256 topic0, uint256 topic1) internal pure returns (IReactive.LogRecord memory log) {
        log = IReactive.LogRecord({
            chain_id: DEST_CHAIN,
            _contract: CALLBACK_CONTRACT,
            topic_0: topic0,
            topic_1: topic1,
            topic_2: 0,
            topic_3: 0,
            data: "",
            block_number: 1,
            op_code: 0,
            block_hash: 0,
            tx_hash: 0,
            log_index: 0
        });
    }

    function _firstCallbackPayload(Vm.Log[] memory logs) internal pure returns (bytes memory, bool) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == CALLBACK_SIG) {
                return (abi.decode(logs[i].data, (bytes)), true);
            }
        }
        return ("", false);
    }

    function _countCallbacks(Vm.Log[] memory logs) internal pure returns (uint256 c) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == CALLBACK_SIG) c++;
        }
    }

    // ── react() routing ──────────────────────────────────────────────────────

    function test_react_positionCreated_emitsPersistAdded() public {
        vm.recordLogs();
        rx.react(_log(CREATED_TOPIC, 42));
        (bytes memory payload, bool found) = _firstCallbackPayload(vm.getRecordedLogs());

        assertTrue(found, "a callback is emitted");
        bytes memory expected =
            abi.encodeWithSignature("persistPositionAdded(address,uint256)", address(0), uint256(42));
        assertEq(payload, expected, "routes to persistPositionAdded with the position id");
    }

    function test_react_positionExited_emitsPersistRemoved() public {
        vm.recordLogs();
        rx.react(_log(EXITED_TOPIC, 7));
        (bytes memory payload, bool found) = _firstCallbackPayload(vm.getRecordedLogs());

        assertTrue(found, "a callback is emitted");
        bytes memory expected =
            abi.encodeWithSignature("persistPositionRemoved(address,uint256)", address(0), uint256(7));
        assertEq(payload, expected, "routes to persistPositionRemoved with the position id");
    }

    function test_react_unknownTopic_isNoOp() public {
        vm.recordLogs();
        rx.react(_log(uint256(keccak256("SomethingElse")), 1));
        assertEq(_countCallbacks(vm.getRecordedLogs()), 0, "unknown topic emits no callback");
    }

    function test_react_emptyBundle_emitsNoSettle() public {
        ILBondReactive.PositionData[] memory empty = new ILBondReactive.PositionData[](0);
        IReactive.LogRecord memory log = _log(BUNDLE_TOPIC, 0);
        log.data = abi.encode(abi.encode(empty)); // event's bytes-data wrapping

        vm.recordLogs();
        rx.react(log);
        assertEq(_countCallbacks(vm.getRecordedLogs()), 0, "empty bundle -> no settle callbacks");
    }

    // ── persist*: access control + activeCount bookkeeping ──────────────────

    function test_persistAdded_onlyCallbackProxy() public {
        vm.expectRevert(bytes("Callback proxy only"));
        rx.persistPositionAdded(address(0), 1);
    }

    function test_persistRemoved_onlyCallbackProxy() public {
        vm.expectRevert(bytes("Callback proxy only"));
        rx.persistPositionRemoved(address(0), 1);
    }

    function test_activeCount_incrementsAndDecrements() public {
        assertEq(rx.activeCount(), 0);

        vm.startPrank(CALLBACK_PROXY);
        rx.persistPositionAdded(address(0), 1);
        rx.persistPositionAdded(address(0), 2);
        assertEq(rx.activeCount(), 2, "two adds");

        rx.persistPositionRemoved(address(0), 1);
        assertEq(rx.activeCount(), 1, "one remove");
        vm.stopPrank();
    }

    /// activeCount must never underflow below zero even on a spurious removal.
    function test_activeCount_neverUnderflows() public {
        vm.prank(CALLBACK_PROXY);
        rx.persistPositionRemoved(address(0), 99);
        assertEq(rx.activeCount(), 0, "remove on empty stays at 0");
    }

    function testFuzz_activeCount_balanced(uint8 adds, uint8 removes) public {
        vm.startPrank(CALLBACK_PROXY);
        for (uint256 i; i < adds; ++i) rx.persistPositionAdded(address(0), i);
        for (uint256 i; i < removes; ++i) rx.persistPositionRemoved(address(0), i);
        vm.stopPrank();

        uint256 expected = adds > removes ? uint256(adds) - removes : 0;
        assertEq(rx.activeCount(), expected, "count tracks adds - removes, floored at 0");
    }
}
