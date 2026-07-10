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

    function setUp() public {
        deployArtifactsAndLabel();

        // Deploy the hook to an address carrying the right permission flags.
        address flags = address(
            uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG)
                ^ (0x5555 << 144)
        );
        bytes memory args = abi.encode(poolManager);
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

    // ── Multi-pool IL marking (derived on-chain, no external dependency) ──────

    function test_ilMark_derivesFromEachPositionsOwnPool() public {
        (PoolKey memory keyA,) = _newPool();
        (PoolKey memory keyB,) = _newPool();

        uint256 pidA = hook.depositILBond(keyA, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.1e18);
        uint256 pidB = hook.depositILBond(keyB, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.1e18);

        // Move only pool A's price.
        _swap(keyA, 25e18, true);

        (int256 ilA,) = hook.ilMark(pidA);
        (int256 ilB, uint256 markB) = hook.ilMark(pidB);

        assertLt(ilA, 0, "A shows IL after its own pool moved");
        assertEq(ilB, 0, "B untouched by A's swap");
        assertEq(markB, 10e18, "B's mark value == liquidity at zero IL");

        // getPosition surfaces the same live mark (frontend path).
        (,,,,,,, int256 viaGet,,) = hook.getPosition(pidA);
        assertEq(viaGet, ilA, "getPosition returns the live derived mark");

        // The mark derives from the SMOOTHED price, not spot: recomputing the
        // closed form at A's smoothed marking price must match exactly.
        (,,,,,, uint160 entryA,,,) = hook.getPosition(pidA);
        (int256 expected,) = hook.computeILMark(entryA, hook.markSqrtPriceX96(keyA.toId()), 10e18);
        assertEq(ilA, expected, "mark == closed form at the smoothed price");
    }

    function test_ilMark_zeroForInactiveOrUnknown() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        _swap(key, 10e18, true);
        (int256 before,) = hook.ilMark(pid);
        assertLt(before, 0, "live position carries a mark");

        hook.exitPosition(pid);
        (int256 afterExit, uint256 mv) = hook.ilMark(pid);
        assertEq(afterExit, 0, "exited position has no mark");
        assertEq(mv, 0);

        (int256 unknown,) = hook.ilMark(999_999);
        assertEq(unknown, 0, "unknown id has no mark");
    }

    /// A single swap moves the smoothed marking price only a fraction of the way
    /// to spot, so one transaction can never place the mark at a manipulated price.
    function test_mark_isSmoothedNotSpot() public {
        (PoolKey memory key, PoolId id) = _newPool();
        int24 markBefore = hook.markTick(id);
        assertEq(markBefore, 0, "mark starts at the opening tick");

        _swap(key, 25e18, true); // one big price move
        (, int24 spotTick,,) = poolManager.getSlot0(id);
        int24 markAfter = hook.markTick(id);

        assertTrue(markAfter != spotTick, "one swap must not set the mark to spot");
        assertLt(markAfter, markBefore, "mark moves toward the trade");
        assertGt(markAfter, spotTick, "but only partially (EWMA)");
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
        ask = bound(ask, 1, type(uint128).max); // 0 means auto-quote, covered elsewhere
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

    function test_deposit_zeroAskAutoQuotesFromPool() public {
        (PoolKey memory key,) = _newPool();
        uint256 quoted = hook.quotePremium(key, tickLower, tickUpper, 10e18);
        assertGt(quoted, 0, "live pool always quotes a nonzero premium");

        uint256 pid = _deposit(key, 0); // ask == 0 -> protocol prices the risk
        (,,,,,,,,, uint256 ask) = hook.getPosition(pid);
        assertEq(ask, quoted, "stored ask == protocol quote");

        // The quoted bond is immediately buyable at that premium.
        _buy(key, pid, makeAddr("buyer"), ask);
        assertEq(hook.getClaimable(address(this), Currency.unwrap(key.currency1)), ask);
    }

    function test_quotePremium_risesWithVolatility() public {
        (PoolKey memory keyA,) = _newPool();
        (PoolKey memory keyB,) = _newPool();
        // Same swap on both pools so notionals stay comparable, then extra
        // volatility only on A.
        _swap(keyA, 10e18, true);
        _swap(keyA, 10e18, false);
        _swap(keyA, 10e18, true);
        _swap(keyA, 10e18, false);
        _swap(keyB, 10e18, true);
        _swap(keyB, 10e18, false);

        uint256 qA = hook.quotePremium(keyA, tickLower, tickUpper, 10e18);
        uint256 qB = hook.quotePremium(keyB, tickLower, tickUpper, 10e18);
        assertGt(qA, 0);
        assertGt(qB, 0);
        assertGe(qA, qB, "more realized volatility must not quote cheaper");
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

    // ── unlock callback access control ────────────────────────────────────────

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

    // ── fee routing: FEE-T earns the swap fees, IL-T earns the principal ──────

    function test_exit_routesFeesToFeeHolder_principalToILHolder() public {
        (PoolKey memory key,) = _newPool();
        address t0 = Currency.unwrap(key.currency0);
        address t1 = Currency.unwrap(key.currency1);

        uint256 pid = _deposit(key, 0.3e18);
        address buyer = makeAddr("buyer");
        _buy(key, pid, buyer, 0.3e18); // buyer holds IL-T; this holds FEE-T

        // Generate real swap fees in both tokens.
        _swap(key, 5e18, true);
        _swap(key, 5e18, false);

        uint256 premium = hook.getClaimable(address(this), t1);
        assertEq(premium, 0.3e18, "premium credited before exit");

        hook.exitPosition(pid);

        // FEE-T holder receives the accrued swap fees on top of the premium.
        assertGt(hook.getClaimable(address(this), t0), 0, "fee leg earns token0 fees");
        assertGt(hook.getClaimable(address(this), t1), premium, "fee leg earns token1 fees beyond premium");
        // IL-T holder receives the principal in both tokens.
        assertGt(hook.getClaimable(buyer, t0), 0, "risk leg gets principal token0");
        assertGt(hook.getClaimable(buyer, t1), 0, "risk leg gets principal token1");
    }

    function test_exit_noSwaps_noFees_principalOnly() public {
        (PoolKey memory key,) = _newPool();
        address t0 = Currency.unwrap(key.currency0);
        uint256 pid = _deposit(key, 0.3e18);
        address buyer = makeAddr("buyer");
        _buy(key, pid, buyer, 0.3e18);

        hook.exitPosition(pid);

        assertEq(hook.getClaimable(address(this), t0), 0, "no swaps -> no token0 fees for FEE-T");
        assertGt(hook.getClaimable(buyer, t0), 0, "principal still goes to IL-T");
    }

    function test_collectFees_harvestsWithoutClosing() public {
        (PoolKey memory key,) = _newPool();
        address t0 = Currency.unwrap(key.currency0);
        address t1 = Currency.unwrap(key.currency1);
        uint256 pid = _deposit(key, 0.2e18);

        _swap(key, 5e18, true);
        _swap(key, 5e18, false);

        (uint256 f0, uint256 f1) = hook.collectFees(pid);
        assertGt(f0 + f1, 0, "fees harvested");
        assertEq(hook.getClaimable(address(this), t0), f0, "token0 fees credited to FEE-T holder");
        assertEq(hook.getClaimable(address(this), t1), f1, "token1 fees credited to FEE-T holder");
        assertTrue(_active(pid), "position stays open");

        // Nothing double-counted: an immediate second harvest yields nothing.
        (uint256 g0, uint256 g1) = hook.collectFees(pid);
        assertEq(g0 + g1, 0, "no fees accrue between harvests");

        // No swaps happened since the harvest, so exit adds principal only
        // (this == ilHolder here) and no further fees.
        uint256 claim0Before = hook.getClaimable(address(this), t0);
        hook.exitPosition(pid);
        assertGt(hook.getClaimable(address(this), t0), claim0Before, "principal credited at exit");
    }

    function test_collectFees_revertsInactive() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        hook.exitPosition(pid);
        vm.expectRevert(ILBondHook.PositionNotActive.selector);
        hook.collectFees(pid);
    }

    // ── full-range enforcement (keeps the RSC's IL formula exact) ─────────────

    function test_deposit_revertsNonFullRange() public {
        (PoolKey memory key,) = _newPool();
        vm.expectRevert(ILBondHook.FullRangeOnly.selector);
        hook.depositILBond(key, -600, 600, 1e18, 1e18, 1e18, 1);
    }

    // ── leg transfers reject the zero address ─────────────────────────────────

    function test_transfers_rejectZeroAddress() public {
        (PoolKey memory key,) = _newPool();
        uint256 pid = _deposit(key, 0.1e18);
        vm.expectRevert(ILBondHook.ZeroAddress.selector);
        hook.transferFeeToken(pid, address(0));
        vm.expectRevert(ILBondHook.ZeroAddress.selector);
        hook.transferILToken(pid, address(0));
    }

    // ── native (ETH) pools: deposit, exit, withdraw ───────────────────────────

    function _newNativePool() internal returns (PoolKey memory key) {
        (Currency c0, Currency c1) = deployCurrencyPair();
        // native ETH is currency0 (address(0) sorts first); reuse c1 as the token
        key = PoolKey(CurrencyLibrary.ADDRESS_ZERO, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        poolManager.initialize(key, Constants.SQRT_PRICE_1_1);
        IERC20Minimal(Currency.unwrap(c1)).approve(address(hook), type(uint256).max);
        c0; // silence unused
    }

    function test_nativePool_depositExitWithdraw() public {
        PoolKey memory key = _newNativePool();
        vm.deal(address(this), 10e18);

        uint256 ethBefore = address(this).balance;
        uint256 pid = hook.depositILBond{value: 2e18}(key, tickLower, tickUpper, 1e18, 2e18, 2e18, 0.1e18);
        // Unused ETH is refunded immediately.
        assertGt(address(this).balance, ethBefore - 2e18, "unused ETH refunded");

        hook.exitPosition(pid);
        uint256 owedEth = hook.getClaimable(address(this), address(0));
        assertGt(owedEth, 0, "native principal claimable");

        uint256 balBefore = address(this).balance;
        hook.withdraw(CurrencyLibrary.ADDRESS_ZERO);
        assertEq(address(this).balance, balBefore + owedEth, "ETH actually paid out on withdraw");
        assertEq(hook.getClaimable(address(this), address(0)), 0, "claim zeroed");
    }

    function test_nativePool_depositRevertsWrongValue() public {
        PoolKey memory key = _newNativePool();
        vm.deal(address(this), 10e18);
        vm.expectRevert(ILBondHook.WrongNativeAmount.selector);
        hook.depositILBond{value: 1e18}(key, tickLower, tickUpper, 1e18, 2e18, 2e18, 0.1e18);
    }

    receive() external payable {}
}
