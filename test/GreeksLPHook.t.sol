// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

import {EasyPosm} from "./utils/libraries/EasyPosm.sol";
import {GreeksLPHook} from "../src/GreeksLPHook.sol";
import {BaseTest} from "./utils/BaseTest.sol";

contract GreeksLPHookTest is BaseTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    Currency currency0;
    Currency currency1;

    PoolKey poolKey;
    GreeksLPHook hook;
    PoolId poolId;

    uint256 tokenId;
    int24 tickLower;
    int24 tickUpper;

    address constant CALLBACK_SENDER = address(0xBEEF);

    function setUp() public {
        deployArtifactsAndLabel();
        (currency0, currency1) = deployCurrencyPair();

        address flags = address(
            uint160(
                Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            ) ^ (0x5555 << 144)
        );

        bytes memory constructorArgs = abi.encode(poolManager, CALLBACK_SENDER);
        deployCodeTo("GreeksLPHook.sol:GreeksLPHook", constructorArgs, flags);
        hook = GreeksLPHook(payable(flags));

        poolKey = PoolKey(currency0, currency1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(hook));
        poolId = poolKey.toId();
        poolManager.initialize(poolKey, Constants.SQRT_PRICE_1_1);

        tickLower = TickMath.minUsableTick(poolKey.tickSpacing);
        tickUpper = TickMath.maxUsableTick(poolKey.tickSpacing);

        // Seed pool with base liquidity via PositionManager
        uint128 liquidityAmount = 100e18;
        (uint256 amount0Expected, uint256 amount1Expected) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityAmount
        );

        (tokenId,) = positionManager.mint(
            poolKey, tickLower, tickUpper, liquidityAmount,
            amount0Expected + 1, amount1Expected + 1,
            address(this), block.timestamp, Constants.ZERO_BYTES
        );
    }

    // ═══════════════════════════════════════════════════════════════
    //                    LAYER 1: DYNAMIC FEE TESTS
    // ═══════════════════════════════════════════════════════════════

    function testAfterSwapEmitsEvent() public {
        _movePrice(1e18, true);
        (uint160 sqrtPriceAfter,,,) = poolManager.getSlot0(poolId);
        assertTrue(sqrtPriceAfter > 0);
        assertTrue(sqrtPriceAfter < Constants.SQRT_PRICE_1_1);
    }

    function testPoolInitializesInventory() public view {
        (,,, bool initialized) = hook.poolInventory(poolId);
        assertTrue(initialized);
    }

    function testSwapWorksWithDynamicFees() public {
        _movePrice(1e18, true);
        _movePrice(1e18, false);
        (uint160 sqrtPrice,,,) = poolManager.getSlot0(poolId);
        assertTrue(sqrtPrice > 0);
    }

    // ═══════════════════════════════════════════════════════════════
    //             PRICE HISTORY TRACKING
    // ═══════════════════════════════════════════════════════════════

    function testPriceHistoryRecordedAfterSwap() public {
        // Initial snapshot from afterInitialize
        assertEq(hook.snapshotCount(poolId), 1);

        _movePrice(1e18, true);
        assertEq(hook.snapshotCount(poolId), 2);

        _movePrice(1e18, false);
        assertEq(hook.snapshotCount(poolId), 3);
    }

    function testPriceHistoryCircularBuffer() public {
        // Fill buffer beyond MAX_SNAPSHOTS (30)
        for (uint256 i = 0; i < 35; i++) {
            _movePrice(0.1e18, i % 2 == 0);
        }
        // Should cap at MAX_SNAPSHOTS
        assertEq(hook.snapshotCount(poolId), 30);
    }

    // ═══════════════════════════════════════════════════════════════
    //            DEPOSIT WITH GREEK PROFILE
    // ═══════════════════════════════════════════════════════════════

    function testDepositWithGreekProfile() public {
        GreeksLPHook.GreekProfile memory profile = _defaultProfile();
        uint256 posId = _depositGreeks(50e18, profile);

        assertEq(posId, 0);
        assertEq(hook.activePositionCount(), 1);

        (address owner, bool active, uint128 liquidity,,, uint160 entrySqrtPrice,,,,) = hook.getPosition(posId);

        assertEq(owner, address(this));
        assertTrue(active);
        assertEq(liquidity, 50e18);
        assertEq(entrySqrtPrice, Constants.SQRT_PRICE_1_1);
    }

    function testDepositInvalidProfile() public {
        GreeksLPHook.GreekProfile memory badProfile = GreeksLPHook.GreekProfile({
            maxGammaBps: 0, minThetaGammaRatio: 1e18, maxDeltaBps: 5000, vegaAction: 1
        });
        vm.expectRevert(GreeksLPHook.InvalidProfile.selector);
        hook.depositWithGreekProfile(poolKey, tickLower, tickUpper, 50e18, 100e18, 100e18, badProfile);
    }

    function testMultipleDeposits() public {
        GreeksLPHook.GreekProfile memory profile = _defaultProfile();
        uint256 pos0 = _depositGreeks(50e18, profile);
        uint256 pos1 = _depositGreeks(30e18, profile);
        assertEq(pos0, 0);
        assertEq(pos1, 1);
        assertEq(hook.activePositionCount(), 2);
    }

    // ═══════════════════════════════════════════════════════════════
    //            GREEKS DATA BUNDLE EMISSION
    // ═══════════════════════════════════════════════════════════════

    function testPrepareGreeksDataEmitsBundle() public {
        _depositGreeks(50e18, _defaultProfile());

        // Generate price history with swaps
        _movePrice(1e18, true);
        _movePrice(0.5e18, false);
        vm.warp(block.timestamp + 720); // simulate 12 minutes

        // Call as callback sender (simulating RC)
        vm.prank(CALLBACK_SENDER);
        hook.prepareGreeksData(address(0));

        // Verify bundle counter incremented
        assertEq(hook.bundleCounter(), 1);
    }

    function testPrepareGreeksDataWithNoPositions() public {
        vm.prank(CALLBACK_SENDER);
        hook.prepareGreeksData(address(0));
        // Should not revert, just emit CycleCompleted
        assertEq(hook.bundleCounter(), 0);
    }

    // ═══════════════════════════════════════════════════════════════
    //            EXECUTE ACTION — REPOSITION (WIDEN)
    // ═══════════════════════════════════════════════════════════════

    function testExecuteActionWiden() public {
        // Use a narrow range so we can widen it
        int24 narrowLower = -600;
        int24 narrowUpper = 600;
        uint256 posId = _depositGreeksRange(50e18, _defaultProfile(), narrowLower, narrowUpper);

        int24 newTickLower = narrowLower - 240; // widen by 4 * 60
        int24 newTickUpper = narrowUpper + 240;

        vm.prank(CALLBACK_SENDER);
        hook.executeAction(address(0), posId, 1, newTickLower, newTickUpper);

        (,, uint128 newLiquidity, int24 posTickLower, int24 posTickUpper,,,,,) = hook.getPosition(posId);
        assertEq(posTickLower, newTickLower);
        assertEq(posTickUpper, newTickUpper);
        assertTrue(newLiquidity > 0, "Should have liquidity in new range");

        console2.log("New liquidity after widen:", newLiquidity);
    }

    function testExecuteActionShift() public {
        // Use a narrow range so shifting stays in bounds
        int24 narrowLower = -600;
        int24 narrowUpper = 600;
        uint256 posId = _depositGreeksRange(50e18, _defaultProfile(), narrowLower, narrowUpper);

        // Move price first to create delta imbalance
        _movePrice(5e18, true);

        int24 shift = 60 * 6; // 6 tick spacings
        int24 newTickLower = narrowLower - shift;
        int24 newTickUpper = narrowUpper - shift;

        vm.prank(CALLBACK_SENDER);
        hook.executeAction(address(0), posId, 4, newTickLower, newTickUpper); // SHIFT_DOWN

        (, bool active, uint128 newLiquidity, int24 posTickLower,,,,,,) = hook.getPosition(posId);
        // Reposition may succeed or fall back to exit if not enough tokens
        if (active) {
            assertEq(posTickLower, newTickLower);
            assertTrue(newLiquidity > 0);
        } else {
            // Exited — tokens should be withdrawable
            (uint256 w0, uint256 w1) = hook.getWithdrawable(address(this));
            assertTrue(w0 > 0 || w1 > 0);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //            EXECUTE ACTION — EXIT
    // ═══════════════════════════════════════════════════════════════

    function testExecuteActionFullExit() public {
        _depositGreeks(50e18, _defaultProfile());

        vm.prank(CALLBACK_SENDER);
        hook.executeAction(address(0), 0, 6, 0, 0); // FULL_EXIT

        (, bool active, uint128 liquidity,,,,,,,) = hook.getPosition(0);
        assertFalse(active);
        assertEq(liquidity, 0);
        assertEq(hook.activePositionCount(), 0);

        (uint256 w0, uint256 w1) = hook.getWithdrawable(address(this));
        assertTrue(w0 > 0 || w1 > 0, "Should have withdrawable tokens");
    }

    function testExecuteActionPartialExit() public {
        _depositGreeks(50e18, _defaultProfile());

        vm.prank(CALLBACK_SENDER);
        hook.executeAction(address(0), 0, 5, 0, 0); // PARTIAL_EXIT (50%)

        (, bool active, uint128 liquidity,,,,,,,) = hook.getPosition(0);
        assertTrue(active);
        assertEq(liquidity, 25e18);
    }

    // ═══════════════════════════════════════════════════════════════
    //            UPDATE GREEKS
    // ═══════════════════════════════════════════════════════════════

    function testUpdateGreeksStoresValues() public {
        _depositGreeks(50e18, _defaultProfile());

        vm.prank(CALLBACK_SENDER);
        hook.updateGreeks(address(0), 0, -1500, 45, 800, 20);

        (,,,,, , int256 delta, uint256 gamma, uint256 theta, uint256 vega) = hook.getPosition(0);
        assertEq(delta, -1500);
        assertEq(gamma, 45);
        assertEq(theta, 800);
        assertEq(vega, 20);
    }

    // ═══════════════════════════════════════════════════════════════
    //            MANUAL EXIT + ACCESS CONTROL
    // ═══════════════════════════════════════════════════════════════

    function testManualExit() public {
        _depositGreeks(50e18, _defaultProfile());

        hook.manualExit(0);

        (, bool active, uint128 liquidity,,,,,,,) = hook.getPosition(0);
        assertFalse(active);
        assertEq(liquidity, 0);
        assertEq(hook.activePositionCount(), 0);

        (uint256 w0, uint256 w1) = hook.getWithdrawable(address(this));
        assertTrue(w0 > 0 || w1 > 0);
    }

    function testManualExitOnlyOwner() public {
        _depositGreeks(50e18, _defaultProfile());

        vm.prank(address(0xDEAD));
        vm.expectRevert(GreeksLPHook.OnlyPositionOwner.selector);
        hook.manualExit(0);
    }

    // ═══════════════════════════════════════════════════════════════
    //            INVENTORY TRACKING
    // ═══════════════════════════════════════════════════════════════

    function testInventoryUpdatesOnDeposit() public {
        _depositGreeks(50e18, _defaultProfile());
        (uint256 totalToken0, uint256 totalToken1,,) = hook.poolInventory(poolId);
        assertTrue(totalToken0 > 0 || totalToken1 > 0);
    }

    // ═══════════════════════════════════════════════════════════════
    //            FULL PIPELINE TEST — BUNDLE + DECODE
    // ═══════════════════════════════════════════════════════════════

    function testFullDataBundlePipeline() public {
        // Deposit two positions with different profiles
        GreeksLPHook.GreekProfile memory conservative = GreeksLPHook.GreekProfile({
            maxGammaBps: 50,
            minThetaGammaRatio: 2e18,
            maxDeltaBps: 3000,
            vegaAction: 1
        });
        GreeksLPHook.GreekProfile memory aggressive = GreeksLPHook.GreekProfile({
            maxGammaBps: 200,
            minThetaGammaRatio: 0.5e18,
            maxDeltaBps: 7000,
            vegaAction: 0
        });

        _depositGreeks(50e18, conservative);
        _depositGreeks(30e18, aggressive);

        // Generate price history (no time warp to avoid deadline issues with approvals)
        for (uint256 i = 0; i < 10; i++) {
            _movePrice(0.5e18, i % 2 == 0);
        }
        vm.warp(block.timestamp + 720); // advance time for theta calculation

        // Trigger data bundle emission
        vm.prank(CALLBACK_SENDER);
        hook.prepareGreeksData(address(0));

        assertEq(hook.bundleCounter(), 1);
        assertTrue(hook.snapshotCount(poolId) >= 10);

        console2.log("Pipeline test passed:");
        console2.log("  Active positions:", hook.activePositionCount());
        console2.log("  Price snapshots:", hook.snapshotCount(poolId));
        console2.log("  Bundles emitted:", hook.bundleCounter());
    }

    // ═══════════════════════════════════════════════════════════════
    //                        HELPERS
    // ═══════════════════════════════════════════════════════════════

    function _defaultProfile() internal pure returns (GreeksLPHook.GreekProfile memory) {
        return GreeksLPHook.GreekProfile({
            maxGammaBps: 100,           // Max 100 BPS IL per 1% price move
            minThetaGammaRatio: 1e18,   // Fees must at least equal gamma
            maxDeltaBps: 5000,          // Max 50% directional skew
            vegaAction: 1               // Widen on vol spike
        });
    }

    function _depositGreeksRange(
        uint128 liquidity,
        GreeksLPHook.GreekProfile memory profile,
        int24 _tickLower,
        int24 _tickUpper
    ) internal returns (uint256) {
        (uint256 amount0, uint256 amount1) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(_tickLower),
            TickMath.getSqrtPriceAtTick(_tickUpper),
            liquidity
        );
        uint256 amount0Max = amount0 + 1e18;
        uint256 amount1Max = amount1 + 1e18;
        IERC20Minimal(Currency.unwrap(currency0)).approve(address(hook), amount0Max);
        IERC20Minimal(Currency.unwrap(currency1)).approve(address(hook), amount1Max);
        return hook.depositWithGreekProfile(
            poolKey, _tickLower, _tickUpper, liquidity, amount0Max, amount1Max, profile
        );
    }

    function _depositGreeks(uint128 liquidity, GreeksLPHook.GreekProfile memory profile)
        internal returns (uint256)
    {
        (uint256 amount0, uint256 amount1) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidity
        );

        uint256 amount0Max = amount0 + 1e18;
        uint256 amount1Max = amount1 + 1e18;

        IERC20Minimal(Currency.unwrap(currency0)).approve(address(hook), amount0Max);
        IERC20Minimal(Currency.unwrap(currency1)).approve(address(hook), amount1Max);

        return hook.depositWithGreekProfile(
            poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, profile
        );
    }

    function _movePrice(uint256 amountIn, bool zeroForOne) internal {
        swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: 0,
            zeroForOne: zeroForOne,
            poolKey: poolKey,
            hookData: Constants.ZERO_BYTES,
            receiver: address(this),
            deadline: block.timestamp + 1
        });
    }
}
