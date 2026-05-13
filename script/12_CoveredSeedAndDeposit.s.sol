// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

import {CoveredLPHook} from "../src/CoveredLPHook.sol";
import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";

/// @notice Seeds base liquidity, opens a covered LP position, simulates a buyer
///         purchasing the option and a price-moving swap.
contract CoveredSeedAndDeposit is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager constant poolManager = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);

    function run() public {
        address token0 = vm.envAddress("TOKEN0");
        address token1 = vm.envAddress("TOKEN1");
        address hookAddr = vm.envAddress("COVERED_HOOK");
        address positionMgr = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
        IUniswapV4Router04 swapRouter = IUniswapV4Router04(payable(0xf13D190e9117920c703d79B5F33732e10049b115));

        PoolKey memory poolKey = PoolKey(
            Currency.wrap(token0), Currency.wrap(token1),
            LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(hookAddr)
        );

        int24 tickLower = TickMath.minUsableTick(60);
        int24 tickUpper = TickMath.maxUsableTick(60);

        vm.startBroadcast();

        // === STEP 1: Seed base liquidity via PositionManager ===
        console2.log("Seeding base liquidity...");
        {
            uint128 baseLiq = 100e18;
            (uint256 amt0, uint256 amt1) = LiquidityAmounts.getAmountsForLiquidity(
                Constants.SQRT_PRICE_1_1,
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                baseLiq
            );

            bytes memory actions = abi.encodePacked(
                uint8(Actions.MINT_POSITION),
                uint8(Actions.SETTLE_PAIR),
                uint8(Actions.SWEEP),
                uint8(Actions.SWEEP)
            );
            bytes[] memory params = new bytes[](4);
            params[0] = abi.encode(poolKey, tickLower, tickUpper, baseLiq, amt0 + 1, amt1 + 1, msg.sender, "");
            params[1] = abi.encode(Currency.wrap(token0), Currency.wrap(token1));
            params[2] = abi.encode(Currency.wrap(token0), msg.sender);
            params[3] = abi.encode(Currency.wrap(token1), msg.sender);

            IPositionManager(positionMgr).modifyLiquidities(
                abi.encode(actions, params),
                block.timestamp + 3600
            );
        }
        console2.log("Base liquidity seeded");

        // === STEP 2: Deposit covered LP — auto-mints option ===
        console2.log("Depositing covered LP...");
        CoveredLPHook hook = CoveredLPHook(payable(hookAddr));

        uint64 duration = 7 days;
        uint256 initialAsk = 0.05e18; // 0.05 token1 premium ask

        (uint256 posId, uint256 optionId) = hook.depositCoveredLP(
            poolKey, tickLower, tickUpper,
            10e18,
            100e18, 100e18,
            duration,
            initialAsk
        );
        console2.log("Position ID:", posId);
        console2.log("Option  ID:", optionId);

        // === STEP 3: Simulate buyer purchasing the option ===
        console2.log("Buyer purchasing option...");
        hook.purchaseOption(optionId, initialAsk);
        console2.log("Option purchased - premium credited to LP");

        // === STEP 4: Swap to move price (and exercise into the option) ===
        console2.log("Executing swaps...");
        swapRouter.swapExactTokensForTokens(15e18, 0, false, poolKey, "", msg.sender, block.timestamp + 3600);
        console2.log("Swap 1: 15e18 oneForZero (push price up toward strike)");

        swapRouter.swapExactTokensForTokens(5e18, 0, true, poolKey, "", msg.sender, block.timestamp + 3600);
        console2.log("Swap 2: 5e18 zeroForOne");

        vm.stopBroadcast();

        // === Final state ===
        PoolId poolId = poolKey.toId();
        (uint160 sqrtPrice, int24 tick,,) = poolManager.getSlot0(poolId);
        console2.log("Final sqrtPrice:", sqrtPrice);
        console2.log("Final tick:", tick);
        console2.log("Active options:", hook.activeOptionCount());
    }
}
