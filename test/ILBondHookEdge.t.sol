// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

import {EasyPosm} from "./utils/libraries/EasyPosm.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {ILBondHook} from "../src/ILBondHook.sol";

/// @notice Edge-case + accounting tests for ILBondHook that complement
///         ILBondHook.t.sol (lifecycle/access) and the invariant suite.
contract ILBondHookEdgeTest is BaseTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    ILBondHook hook;
    int24 tickLower;
    int24 tickUpper;

    bytes32 constant BUNDLE_TOPIC = keccak256("ILBondDataBundle(uint256,bytes)");
    bytes32 constant POOL_REGISTERED_TOPIC =
        keccak256("PoolRegistered(bytes32,address,address,int24,uint160)");

    function setUp() public {
        deployArtifactsAndLabel();
        address flags = address(
            uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG)
                ^ (0x7777 << 144)
        );
        deployCodeTo("ILBondHook.sol:ILBondHook", abi.encode(poolManager, address(this)), flags);
        hook = ILBondHook(payable(flags));
        tickLower = TickMath.minUsableTick(60);
        tickUpper = TickMath.maxUsableTick(60);
    }

    function _newPool() internal returns (PoolKey memory key, PoolId id) {
        (Currency c0, Currency c1) = deployCurrencyPair();
        key = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        id = key.toId();
        poolManager.initialize(key, Constants.SQRT_PRICE_1_1);
        uint128 liq = 100e18;
        (uint256 a0, uint256 a1) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liq
        );
        positionManager.mint(
            key, tickLower, tickUpper, liq, a0 + 1, a1 + 1, address(this), block.timestamp, Constants.ZERO_BYTES
        );
        IERC20Minimal(Currency.unwrap(c0)).approve(address(hook), type(uint256).max);
        IERC20Minimal(Currency.unwrap(c1)).approve(address(hook), type(uint256).max);
    }

    function _deposit(PoolKey memory key, uint256 ask) internal returns (uint256) {
        return hook.depositILBond(key, tickLower, tickUpper, 10e18, 100e18, 100e18, ask);
    }

    function _buy(PoolKey memory key, uint256 posId, address buyer, uint256 ask) internal {
        address t1 = Currency.unwrap(key.currency1);
        deal(t1, buyer, ask);
        vm.startPrank(buyer);
        IERC20Minimal(t1).approve(address(hook), ask);
        hook.buyILBond(posId);
        vm.stopPrank();
    }

    function _active(uint256 pid) internal view returns (bool a) {
        (,,, a,,,,,,) = hook.getPosition(pid);
    }

    function _liq(uint256 pid) internal view returns (uint128 l) {
        (,,,,, l,,,,) = hook.getPosition(pid);
    }

    // ── deposit: token accounting / refunds ─────────────────────────────────

    /// After a deposit the hook must hold no leftover tokens: it pulls the max,
    /// settles only what the mint used, and refunds the remainder to the LP.
    function test_deposit_refundsUnusedTokens_noneStuckInHook() public {
        (PoolKey memory key,) = _newPool();
        address t0 = Currency.unwrap(key.currency0);
        address t1 = Currency.unwrap(key.currency1);

        uint256 hook0Before = IERC20Minimal(t0).balanceOf(address(hook));
        uint256 hook1Before = IERC20Minimal(t1).balanceOf(address(hook));

        // amount{0,1}Max are huge relative to what 10e18 liquidity needs.
        hook.depositILBond(key, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.1e18);

        assertEq(IERC20Minimal(t0).balanceOf(address(hook)), hook0Before, "no token0 stuck in hook");
        assertEq(IERC20Minimal(t1).balanceOf(address(hook)), hook1Before, "no token1 stuck in hook");
    }

    /// The LP only spends what the mint actually consumed, not the max.
    function test_deposit_lpSpendsOnlyUsed() public {
        (PoolKey memory key,) = _newPool();
        address t0 = Currency.unwrap(key.currency0);
        address t1 = Currency.unwrap(key.currency1);

        (uint256 used0, uint256 used1) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            10e18
        );

        uint256 b0 = IERC20Minimal(t0).balanceOf(address(this));
        uint256 b1 = IERC20Minimal(t1).balanceOf(address(this));
        hook.depositILBond(key, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.1e18);

        // Spent should equal `used` within a rounding wei.
        assertApproxEqAbs(b0 - IERC20Minimal(t0).balanceOf(address(this)), used0, 2, "spent ~ used0");
        assertApproxEqAbs(b1 - IERC20Minimal(t1).balanceOf(address(this)), used1, 2, "spent ~ used1");
    }

    function test_deposit_emitsPositionCreated() public {
        (PoolKey memory key,) = _newPool();
        (uint160 sp,,,) = poolManager.getSlot0(key.toId());
        vm.expectEmit(true, true, false, true, address(hook));
        emit ILBondHook.PositionCreated(0, address(this), sp);
        hook.depositILBond(key, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.1e18);
    }

    function test_init_emitsPoolRegistered() public {
        (Currency c0, Currency c1) = deployCurrencyPair();
        PoolKey memory key = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        vm.recordLogs();
        poolManager.initialize(key, Constants.SQRT_PRICE_1_1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == POOL_REGISTERED_TOPIC) found = true;
        }
        assertTrue(found, "PoolRegistered emitted on init");
        assertTrue(hook.poolInitialized(key.toId()), "poolInitialized set");
    }

    function test_deposit_sequentialIds() public {
        (PoolKey memory key,) = _newPool();
        assertEq(_deposit(key, 0.1e18), 0);
        assertEq(_deposit(key, 0.1e18), 1);
        assertEq(_deposit(key, 0.1e18), 2);
        assertEq(hook.nextPositionId(), 3);
        assertEq(hook.activePositionCount(), 3);
    }

    // ── premium routing after a FEE-T transfer ──────────────────────────────

    /// A buy must credit the CURRENT fee holder, even after FEE-T was transferred.
    function test_premium_creditedToCurrentFeeHolder() public {
        (PoolKey memory key,) = _newPool();
        address t1 = Currency.unwrap(key.currency1);
        uint256 pid = _deposit(key, 0.5e18);

        address newFee = makeAddr("newFee");
        hook.transferFeeToken(pid, newFee); // move the yield leg

        _buy(key, pid, makeAddr("buyer"), 0.5e18);

        assertEq(hook.getClaimable(newFee, t1), 0.5e18, "premium goes to current fee holder");
        assertEq(hook.getClaimable(address(this), t1), 0, "old fee holder gets nothing");
    }

    // ── exit authorization across all three roles ───────────────────────────

    function test_exit_byILBuyer_authorized() public {
        (PoolKey memory key,) = _newPool();
        address t0 = Currency.unwrap(key.currency0);
        uint256 pid = _deposit(key, 0.3e18);
        address buyer = makeAddr("buyer");
        _buy(key, pid, buyer, 0.3e18); // buyer is now ilHolder

        vm.prank(buyer);
        hook.exitPosition(pid);

        assertFalse(_active(pid), "exited");
        assertGt(hook.getClaimable(buyer, t0), 0, "underlying credited to IL holder (buyer)");
    }

    // ── active-set bookkeeping (swap-and-pop) ───────────────────────────────

    /// Exiting a middle element must move the last element into its slot, keep
    /// the survivors active, and shrink the count.
    function test_activeSet_removeMiddle_keepsSurvivors() public {
        (PoolKey memory key,) = _newPool();
        uint256 p0 = _deposit(key, 0.1e18);
        uint256 p1 = _deposit(key, 0.1e18);
        uint256 p2 = _deposit(key, 0.1e18);

        hook.exitPosition(p1); // remove the middle

        assertEq(hook.activePositionCount(), 2, "count shrinks");
        assertTrue(_active(p0) && _active(p2), "survivors stay active");
        assertFalse(_active(p1), "p1 inactive");

        // The active id list contains exactly {p0, p2} (order is swap-and-pop).
        uint256 a = hook.activePositionIds(0);
        uint256 b = hook.activePositionIds(1);
        assertTrue((a == p0 && b == p2) || (a == p2 && b == p0), "active set == {p0,p2}");
    }

    function test_exit_zeroesLiquidity() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        assertEq(_liq(pid), 10e18);
        hook.exitPosition(pid);
        assertEq(_liq(pid), 0, "liquidity zeroed on exit");
    }

    // ── claimable accumulation ──────────────────────────────────────────────

    function test_claim_accumulatesAcrossExits() public {
        (PoolKey memory key,) = _newPool();
        address t0 = Currency.unwrap(key.currency0);
        uint256 p0 = _deposit(key, 0.1e18);
        uint256 p1 = _deposit(key, 0.1e18);

        hook.exitPosition(p0);
        uint256 afterFirst = hook.getClaimable(address(this), t0);
        hook.exitPosition(p1);
        uint256 afterSecond = hook.getClaimable(address(this), t0);

        assertGt(afterFirst, 0, "first exit credits");
        assertGt(afterSecond, afterFirst, "second exit adds to the same claim");
    }

    // ── bundle correctness: excludes exited positions ───────────────────────

    function test_bundle_excludesExitedPositions() public {
        (PoolKey memory key,) = _newPool();
        uint256 p0 = _deposit(key, 0.1e18);
        uint256 p1 = _deposit(key, 0.1e18);
        hook.exitPosition(p0); // only p1 remains active

        vm.recordLogs();
        hook.prepareILBondData(address(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        ILBondHook.PositionData[] memory pts;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == BUNDLE_TOPIC) {
                pts = abi.decode(abi.decode(logs[i].data, (bytes)), (ILBondHook.PositionData[]));
            }
        }
        assertEq(pts.length, 1, "only active positions in the bundle");
        assertEq(pts[0].positionId, p1, "the remaining active one");
    }

    // ── settleILMark emits the mark event ───────────────────────────────────

    function test_settleILMark_emitsILMarkUpdated() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        vm.expectEmit(true, false, false, true, address(hook));
        emit ILBondHook.ILMarkUpdated(pid, -250, 7e18);
        hook.settleILMark(address(0), pid, -250, 7e18);
    }

    // ── currentFee on an uninitialized pool falls back to base ──────────────

    function test_currentFee_uninitializedPoolIsBase() public view {
        PoolId fake = PoolId.wrap(keccak256("never-initialized"));
        assertEq(hook.currentFee(fake), hook.BASE_FEE(), "uninitialized -> base fee");
    }

    // ── fuzz: deposit never strands tokens in the hook, any liquidity size ──

    function testFuzz_deposit_noTokensStuck(uint128 liqSeed) public {
        (PoolKey memory key,) = _newPool();
        uint128 liq = uint128(bound(liqSeed, 1e12, 50e18));
        address t0 = Currency.unwrap(key.currency0);
        address t1 = Currency.unwrap(key.currency1);
        uint256 h0 = IERC20Minimal(t0).balanceOf(address(hook));
        uint256 h1 = IERC20Minimal(t1).balanceOf(address(hook));
        hook.depositILBond(key, tickLower, tickUpper, liq, 100e18, 100e18, 0.1e18);
        assertEq(IERC20Minimal(t0).balanceOf(address(hook)), h0, "no token0 stranded");
        assertEq(IERC20Minimal(t1).balanceOf(address(hook)), h1, "no token1 stranded");
    }
}
