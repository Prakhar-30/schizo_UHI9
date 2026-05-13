// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";

/// @notice Seeds base liquidity into the pool via PositionManager
contract SeedLiquidity is Script {
    function run() public {
        address token0 = vm.envAddress("TOKEN0");
        address token1 = vm.envAddress("TOKEN1");
        address hook = vm.envAddress("HOOK");
        address positionManager = vm.envAddress("POSITION_MANAGER");

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(hook)
        });

        int24 tickLower = TickMath.minUsableTick(60);
        int24 tickUpper = TickMath.maxUsableTick(60);

        uint128 liquidityAmount = 100e18;
        uint160 sqrtPrice = Constants.SQRT_PRICE_1_1;

        (uint256 amount0, uint256 amount1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPrice,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityAmount
        );

        console2.log("Amount0 needed:", amount0);
        console2.log("Amount1 needed:", amount1);

        // Encode MINT_POSITION + SETTLE_PAIR + SWEEP + SWEEP
        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION),
            uint8(Actions.SETTLE_PAIR),
            uint8(Actions.SWEEP),
            uint8(Actions.SWEEP)
        );

        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(poolKey, tickLower, tickUpper, liquidityAmount, amount0 + 1, amount1 + 1, msg.sender, "");
        params[1] = abi.encode(Currency.wrap(token0), Currency.wrap(token1));
        params[2] = abi.encode(Currency.wrap(token0), msg.sender);
        params[3] = abi.encode(Currency.wrap(token1), msg.sender);

        vm.startBroadcast();
        IPositionManager(positionManager).modifyLiquidities(
            abi.encode(actions, params),
            block.timestamp + 3600
        );
        vm.stopBroadcast();

        console2.log("Base liquidity seeded successfully!");
    }
}
