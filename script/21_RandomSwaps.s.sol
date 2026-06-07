// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";

/// @notice Fires randomized swaps across every pool to populate price history.
contract RandomSwaps is Script {
    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;
    address constant HOOK = 0x9D19eA2aad6c8748d566f28fe375fb8BCAA350c0;
    IUniswapV4Router04 constant ROUTER = IUniswapV4Router04(payable(0xf13D190e9117920c703d79B5F33732e10049b115));

    address constant WETH = 0x748b5C9623528D346C414F4f236B3b5b5c7683cb;
    address constant WBTC = 0x912A7Fb66391eAe95DDee40B664FF497108580CD;
    address constant LINK = 0x160fC2D6a542565ba7C2a57E18d6b28F62C8D0C7;
    address constant UNI = 0xCbAcA08f7eB9eB07537F344EbeC7E79302F60823;
    address constant AAVE = 0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba;
    address constant GHO = 0x00A311cd8BE35953635b0Bc619bdC807782dfC5E;
    address constant DAI = 0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357;
    address constant EURS = 0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E;
    address constant USDC = 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8;
    address constant USDT = 0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0;

    address me;

    function run() public {
        vm.startBroadcast();
        me = msg.sender;

        address[10] memory toks = [WETH, WBTC, LINK, UNI, AAVE, GHO, DAI, EURS, USDC, USDT];
        for (uint256 i; i < toks.length; ++i) {
            IERC20(toks[i]).approve(address(ROUTER), type(uint256).max);
        }

        address[2][10] memory pairs = [
            [WETH, USDC], [WBTC, USDT], [WETH, DAI], [LINK, WETH], [UNI, WETH],
            [AAVE, WETH], [GHO, DAI], [WBTC, WETH], [EURS, WETH], [USDC, DAI]
        ];

        uint256 seed = uint256(keccak256(abi.encode(block.timestamp, block.number)));
        for (uint256 p; p < pairs.length; ++p) {
            (address t0, address t1) = pairs[p][0] < pairs[p][1]
                ? (pairs[p][0], pairs[p][1])
                : (pairs[p][1], pairs[p][0]);
            PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(HOOK));

            uint256 nSwaps = 10 + (seed % 5); // 10..14 swaps per pool
            for (uint256 s; s < nSwaps; ++s) {
                seed = uint256(keccak256(abi.encode(seed, p, s)));
                bool zeroForOne = (seed % 2 == 0);
                address tokenIn = zeroForOne ? t0 : t1;
                uint8 dec = IERC20(tokenIn).decimals();
                uint256 human = 2 + (seed % 25); // 2..26 human units
                uint256 amountIn = human * (10 ** dec);

                try ROUTER.swapExactTokensForTokens(
                    amountIn, 0, zeroForOne, key, "", me, block.timestamp + 3600
                ) {
                    console2.log("swap ok pool", p, zeroForOne ? 1 : 0);
                } catch {
                    console2.log("swap skip pool", p);
                }
            }
        }

        vm.stopBroadcast();
    }
}
