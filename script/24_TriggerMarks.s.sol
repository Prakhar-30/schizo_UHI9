// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";

/// @notice Moves price on the 3 pools that have IL-bond positions, so the hook's
///         smoothed mark moves and every position re-prices on the next read.
contract TriggerMarks is Script {
    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;
    address constant HOOK = 0x57696AB5077Aa634c13682C3d3E84287935290c0;
    IUniswapV4Router04 constant ROUTER = IUniswapV4Router04(payable(0xf13D190e9117920c703d79B5F33732e10049b115));

    address constant WETH = 0x748b5C9623528D346C414F4f236B3b5b5c7683cb;
    address constant WBTC = 0x912A7Fb66391eAe95DDee40B664FF497108580CD;
    address constant AAVE = 0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba;
    address constant EURS = 0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E;

    function run() public {
        vm.startBroadcast();
        address me = msg.sender;
        address[4] memory toks = [WETH, WBTC, AAVE, EURS];
        for (uint256 i; i < toks.length; ++i) IERC20(toks[i]).approve(address(ROUTER), type(uint256).max);

        address[2][3] memory pairs = [[WBTC, WETH], [AAVE, WETH], [EURS, WETH]];
        uint256 seed = uint256(keccak256(abi.encode(block.timestamp, block.number)));

        for (uint256 p; p < pairs.length; ++p) {
            (address t0, address t1) = pairs[p][0] < pairs[p][1] ? (pairs[p][0], pairs[p][1]) : (pairs[p][1], pairs[p][0]);
            PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(HOOK));
            // Net-directional bias so the price actually moves and IL shows up.
            for (uint256 s; s < 6; ++s) {
                seed = uint256(keccak256(abi.encode(seed, p, s)));
                bool zeroForOne = s % 4 != 3; // mostly one direction, occasional reverse
                address tokenIn = zeroForOne ? t0 : t1;
                uint8 dec = IERC20(tokenIn).decimals();
                uint256 amountIn = (8 + (seed % 18)) * (10 ** dec); // 8..25 human units
                try ROUTER.swapExactTokensForTokens(amountIn, 0, zeroForOne, key, "", me, block.timestamp + 3600) {
                    console2.log("swap pool", p, zeroForOne ? 1 : 0);
                } catch {
                    console2.log("skip pool", p);
                }
            }
        }
        vm.stopBroadcast();
    }
}
