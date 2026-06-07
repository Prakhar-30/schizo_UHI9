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

contract ILBondHookTest is BaseTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    ILBondHook hook;
    int24 tickLower;
    int24 tickUpper;

    // ILBondDataBundle(uint256 indexed bundleId, bytes data)
    bytes32 constant BUNDLE_TOPIC = keccak256("ILBondDataBundle(uint256,bytes)");

    function setUp() public {
        deployArtifactsAndLabel();

        // Deploy the hook to an address carrying the right permission flags.
        address flags = address(
            uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG)
                ^ (0x5555 << 144)
        );
        // callbackSender = address(this) so this test can call the RC-only entrypoints.
        bytes memory args = abi.encode(poolManager, address(this));
        deployCodeTo("ILBondHook.sol:ILBondHook", args, flags);
        hook = ILBondHook(payable(flags));

        tickLower = TickMath.minUsableTick(60);
        tickUpper = TickMath.maxUsableTick(60);
    }

    // Initialize a dynamic-fee pool with this hook and seed full-range liquidity.
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

        // Approve the hook to pull tokens for depositILBond.
        IERC20Minimal(Currency.unwrap(c0)).approve(address(hook), type(uint256).max);
        IERC20Minimal(Currency.unwrap(c1)).approve(address(hook), type(uint256).max);
    }

    function _swap(PoolKey memory key, uint256 amountIn, bool zeroForOne) internal {
        swapRouter.swapExactTokensForTokens(
            amountIn, 0, zeroForOne, key, "", address(this), block.timestamp + 1
        );
    }

    // ── Dynamic fee ──────────────────────────────────────────────────────────

    function test_fee_startsAtBase() public {
        (, PoolId id) = _newPool();
        assertEq(hook.currentFee(id), hook.BASE_FEE(), "fresh pool should charge the base fee");
    }

    function test_fee_risesWithVolatility() public {
        (PoolKey memory key, PoolId id) = _newPool();
        assertEq(hook.currentFee(id), hook.BASE_FEE());

        // A large swap moves the tick a lot → realized volatility jumps.
        _swap(key, 20e18, true);
        uint24 feeAfter = hook.currentFee(id);

        assertGt(feeAfter, hook.BASE_FEE(), "fee must rise after a volatile swap");
        assertLe(feeAfter, hook.MAX_FEE(), "fee must never exceed the cap");
    }

    function test_fee_neverExceedsCap() public {
        (PoolKey memory key, PoolId id) = _newPool();
        // Hammer the pool with big alternating swaps.
        for (uint256 i; i < 6; ++i) {
            _swap(key, 30e18, i % 2 == 0);
        }
        assertLe(hook.currentFee(id), hook.MAX_FEE(), "capped");
        assertGt(hook.currentFee(id), hook.BASE_FEE(), "elevated after sustained volatility");
    }

    function test_fee_isPerPool() public {
        (PoolKey memory keyA, PoolId idA) = _newPool();
        (, PoolId idB) = _newPool();

        _swap(keyA, 25e18, true); // move pool A only

        assertGt(hook.currentFee(idA), hook.BASE_FEE(), "A volatile -> elevated");
        assertEq(hook.currentFee(idB), hook.BASE_FEE(), "B untouched -> base");
    }

    // ── Multi-pool IL marking ────────────────────────────────────────────────

    function test_bundle_marksEachPositionAgainstItsOwnPoolPrice() public {
        (PoolKey memory keyA,) = _newPool();
        (PoolKey memory keyB,) = _newPool();

        uint256 pidA = hook.depositILBond(keyA, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.1e18);
        uint256 pidB = hook.depositILBond(keyB, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.1e18);

        // Move only pool A's price.
        _swap(keyA, 25e18, true);

        (uint160 sqrtA,,,) = poolManager.getSlot0(keyA.toId());
        (uint160 sqrtB,,,) = poolManager.getSlot0(keyB.toId());

        vm.recordLogs();
        hook.prepareILBondData(address(0)); // authorizedSenderOnly — this == callbackSender
        Vm.Log[] memory logs = vm.getRecordedLogs();

        ILBondHook.PositionData[] memory pts;
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == BUNDLE_TOPIC) {
                bytes memory inner = abi.decode(logs[i].data, (bytes));
                pts = abi.decode(inner, (ILBondHook.PositionData[]));
                found = true;
                break;
            }
        }
        assertTrue(found, "bundle emitted");
        assertEq(pts.length, 2, "both positions in bundle");

        for (uint256 i; i < pts.length; ++i) {
            if (pts[i].positionId == pidA) {
                assertEq(pts[i].currentSqrtPriceX96, sqrtA, "A marked at A's price");
                assertTrue(pts[i].currentSqrtPriceX96 != pts[i].entrySqrtPriceX96, "A moved");
            } else if (pts[i].positionId == pidB) {
                assertEq(pts[i].currentSqrtPriceX96, sqrtB, "B marked at B's own price");
                assertEq(pts[i].currentSqrtPriceX96, pts[i].entrySqrtPriceX96, "B unmoved");
            }
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

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

    // ── deposit ────────────────────────────────────────────────────────────────

    function test_deposit_incrementsAndStores() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = hook.depositILBond(key, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.5e18);
        assertEq(pid, 0);
        assertEq(hook.nextPositionId(), 1);
        assertEq(hook.activePositionCount(), 1);
        (address lp,,, bool active,, uint128 liq,,,, uint256 ask) = hook.getPosition(pid);
        assertEq(lp, address(this));
        assertTrue(active);
        assertEq(liq, 10e18);
        assertEq(ask, 0.5e18);
    }

    function test_deposit_revertsUninitializedPool() public {
        (Currency c0, Currency c1) = deployCurrencyPair();
        PoolKey memory key = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        IERC20Minimal(Currency.unwrap(c0)).approve(address(hook), type(uint256).max);
        IERC20Minimal(Currency.unwrap(c1)).approve(address(hook), type(uint256).max);
        vm.expectRevert(ILBondHook.PoolNotInitialized.selector);
        hook.depositILBond(key, tickLower, tickUpper, 10e18, 100e18, 100e18, 1e18);
    }

    function testFuzz_deposit_storesParams(uint128 liq, uint256 ask) public {
        (PoolKey memory key,) = _newPool();
        liq = uint128(bound(liq, 1e12, 50e18));
        uint256 pid = hook.depositILBond(key, tickLower, tickUpper, liq, 100e18, 100e18, ask);
        (,,, bool active,, uint128 L,,,, uint256 a) = hook.getPosition(pid);
        assertTrue(active);
        assertEq(L, liq);
        assertEq(a, ask);
    }

    // ── buyILBond ────────────────────────────────────────────────────────────

    function test_buy_transfersILAndCreditsPremium() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.3e18);
        address buyer = makeAddr("buyer");
        _buy(key, pid, buyer, 0.3e18);

        (,, address ilHolder,, bool sold,,,,,) = hook.getPosition(pid);
        assertEq(ilHolder, buyer, "IL-T transferred to buyer");
        assertTrue(sold);
        assertEq(hook.getClaimable(address(this), Currency.unwrap(key.currency1)), 0.3e18, "premium credited to fee holder");
    }

    function test_buy_revertsZeroPremium() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0);
        vm.expectRevert(ILBondHook.InvalidPremium.selector);
        hook.buyILBond(pid);
    }

    function test_buy_revertsAlreadySold() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.2e18);
        _buy(key, pid, makeAddr("b1"), 0.2e18);
        vm.expectRevert(ILBondHook.PositionAlreadyExited.selector);
        vm.prank(makeAddr("b2"));
        hook.buyILBond(pid);
    }

    function test_buy_revertsInactive() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.2e18);
        hook.exitPosition(pid);
        vm.expectRevert(ILBondHook.PositionNotActive.selector);
        hook.buyILBond(pid);
    }

    function testFuzz_buy_creditsPremium(uint256 ask) public {
        ask = bound(ask, 1, 1e24);
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, ask);
        address t1 = Currency.unwrap(key.currency1);
        uint256 before = hook.getClaimable(address(this), t1);
        _buy(key, pid, makeAddr("buyer"), ask);
        assertEq(hook.getClaimable(address(this), t1), before + ask);
    }

    // ── token transfers (FEE-T / IL-T) ────────────────────────────────────────

    function test_transferFee_onlyHolder() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        vm.expectRevert(ILBondHook.NotFeeHolder.selector);
        vm.prank(makeAddr("stranger"));
        hook.transferFeeToken(pid, makeAddr("x"));

        hook.transferFeeToken(pid, makeAddr("newFee"));
        (, address feeHolder,,,,,,,,) = hook.getPosition(pid);
        assertEq(feeHolder, makeAddr("newFee"));
    }

    function test_transferIL_onlyHolder() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        vm.expectRevert(ILBondHook.NotILHolder.selector);
        vm.prank(makeAddr("stranger"));
        hook.transferILToken(pid, makeAddr("x"));

        hook.transferILToken(pid, makeAddr("newIL"));
        (,, address ilHolder,,,,,,,) = hook.getPosition(pid);
        assertEq(ilHolder, makeAddr("newIL"));
    }

    // ── exit + withdraw (per-token claims) ────────────────────────────────────

    function test_exit_authorizedOnly() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        vm.expectRevert(ILBondHook.OnlyPositionOwner.selector);
        vm.prank(makeAddr("stranger"));
        hook.exitPosition(pid);
    }

    function test_exit_creditsClaimableAndDeactivates() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        assertEq(hook.activePositionCount(), 1);

        hook.exitPosition(pid);

        assertFalse(_active(pid), "deactivated");
        assertEq(hook.activePositionCount(), 0, "removed from active set");
        assertGt(hook.getClaimable(address(this), Currency.unwrap(key.currency0)), 0, "token0 credited");
        assertGt(hook.getClaimable(address(this), Currency.unwrap(key.currency1)), 0, "token1 credited");
    }

    function test_exit_revertsInactive() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        hook.exitPosition(pid);
        vm.expectRevert(ILBondHook.PositionNotActive.selector);
        hook.exitPosition(pid);
    }

    function test_withdraw_perToken_paysCorrectly() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.4e18);
        address buyer = makeAddr("buyer");
        _buy(key, pid, buyer, 0.4e18);   // buyer becomes IL holder; premium -> this (fee holder)
        hook.exitPosition(pid);          // credits token0+token1 to buyer (IL holder)

        address t0 = Currency.unwrap(key.currency0);
        address t1 = Currency.unwrap(key.currency1);

        // fee holder (this) claims the premium in token1.
        uint256 premium = hook.getClaimable(address(this), t1);
        assertEq(premium, 0.4e18);
        uint256 balBefore = IERC20Minimal(t1).balanceOf(address(this));
        hook.withdraw(key.currency1);
        assertEq(IERC20Minimal(t1).balanceOf(address(this)), balBefore + premium);
        assertEq(hook.getClaimable(address(this), t1), 0, "zeroed after claim");

        // buyer claims the underlying in BOTH tokens, each in its own token.
        uint256 owe0 = hook.getClaimable(buyer, t0);
        uint256 owe1 = hook.getClaimable(buyer, t1);
        assertGt(owe0, 0);
        assertGt(owe1, 0);
        vm.startPrank(buyer);
        uint256 b0 = IERC20Minimal(t0).balanceOf(buyer);
        uint256 b1 = IERC20Minimal(t1).balanceOf(buyer);
        hook.withdraw(key.currency0);
        hook.withdraw(key.currency1);
        vm.stopPrank();
        assertEq(IERC20Minimal(t0).balanceOf(buyer), b0 + owe0);
        assertEq(IERC20Minimal(t1).balanceOf(buyer), b1 + owe1);
    }

    function test_withdraw_revertsNothing() public {
        vm.expectRevert(ILBondHook.NothingToWithdraw.selector);
        hook.withdraw(Currency.wrap(address(0xdead)));
    }

    // ── RC-only entrypoints (access control) ──────────────────────────────────

    function test_settleILMark_authorizedOnly() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);

        vm.expectRevert(bytes("Authorized sender only"));
        vm.prank(makeAddr("stranger"));
        hook.settleILMark(address(0), pid, -150, 9e18);

        hook.settleILMark(address(0), pid, -150, 9e18); // this == callbackSender
        (,,,,,,, int256 ilBps, uint256 mark,) = hook.getPosition(pid);
        assertEq(ilBps, -150);
        assertEq(mark, 9e18);
    }

    function test_settleILMark_inactiveIsNoOp() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        hook.exitPosition(pid);
        hook.settleILMark(address(0), pid, -777, 1e18); // no revert, no effect
        (,,,,,,, int256 ilBps,,) = hook.getPosition(pid);
        assertEq(ilBps, 0, "inactive position mark untouched");
    }

    function test_prepareILBondData_authorizedOnly() public {
        vm.expectRevert(bytes("Authorized sender only"));
        vm.prank(makeAddr("stranger"));
        hook.prepareILBondData(address(0));
    }

    function test_prepareILBondData_emptyEmitsCycle() public {
        vm.recordLogs();
        hook.prepareILBondData(address(0)); // no active positions
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == keccak256("CycleCompleted(uint256,uint256)")) found = true;
        }
        assertTrue(found, "empty cycle emits CycleCompleted");
    }

    function test_unlockCallback_onlyPoolManager() public {
        vm.expectRevert(ILBondHook.OnlyPoolManager.selector);
        hook.unlockCallback("");
    }

    // ── dynamic fee: decay + fuzz bounds ──────────────────────────────────────

    function test_fee_decaysInCalm() public {
        (PoolKey memory key, PoolId id) = _newPool();
        _swap(key, 30e18, true);
        uint24 peak = hook.currentFee(id);
        assertGt(peak, hook.BASE_FEE());
        for (uint256 i; i < 12; ++i) {
            _swap(key, 1e14, i % 2 == 0); // tiny swaps -> volatility decays
        }
        uint24 calm = hook.currentFee(id);
        assertLt(calm, peak, "fee decays as volatility subsides");
        assertGe(calm, hook.BASE_FEE());
    }

    function testFuzz_fee_alwaysBounded(uint256 amt, bool dir) public {
        (PoolKey memory key, PoolId id) = _newPool();
        amt = bound(amt, 1e12, 50e18);
        _swap(key, amt, dir);
        uint24 f = hook.currentFee(id);
        assertGe(f, hook.BASE_FEE());
        assertLe(f, hook.MAX_FEE());
    }
}
