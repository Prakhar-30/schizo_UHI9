// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";

/// @notice Drives price-moving swaps so the hook emits SwapOccurred → RC reacts.
contract ILBondSwaps is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager constant poolManager = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    IUniswapV4Router04 constant swapRouter = IUniswapV4Router04(payable(0xf13D190e9117920c703d79B5F33732e10049b115));

    address constant TOKEN0 = 0x1E0a671C889e49fA2Ecf2F07E3930cd9B11E3591; // ALPHA
    address constant TOKEN1 = 0x9a731FC6652C8cc101ABcB0717d808ab09397aB9; // BETA
    address constant HOOK = 0x55f571E0DC76De9154DeA40B4749a6449CF510C0;

    function run() public {
        PoolKey memory poolKey = PoolKey(
            Currency.wrap(TOKEN0), Currency.wrap(TOKEN1),
            LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(HOOK)
        );

        vm.startBroadcast();
        swapRouter.swapExactTokensForTokens(20e18, 0, true,  poolKey, "", msg.sender, block.timestamp + 3600);
        swapRouter.swapExactTokensForTokens(10e18, 0, false, poolKey, "", msg.sender, block.timestamp + 3600);
        swapRouter.swapExactTokensForTokens(15e18, 0, true,  poolKey, "", msg.sender, block.timestamp + 3600);
        vm.stopBroadcast();

        PoolId id = poolKey.toId();
        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(id);
        console2.log("final sqrtPriceX96:", sqrtP);
        console2.log("final tick:", tick);
    }
}
