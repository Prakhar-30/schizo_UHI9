// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {BaseScript} from "./base/BaseScript.sol";

/// @notice 6 mixed-direction swaps across the 3 Unichain Sepolia pools, sized to
///         move price (and thus IL) without draining the seeded liquidity. Each
///         swap nudges the hook's smoothed mark, so charts get real history.
///
///   forge script script/31_UnichainSwaps.s.sol --rpc-url https://sepolia.unichain.org \
///       --private-key $KEY --broadcast --slow
contract UnichainSwaps is BaseScript {
    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;

    address constant HOOK = 0x20487A756FececfF800d15EC76C78e0487A2D0c0;
    address constant MWETH = 0xC72377c60F46b7Bf812A55728d3b4c57b7Be692e; // 18
    address constant MWBTC = 0x18CF733BD208ff54d4855bcA459F5099f38d4f2C; // 8
    address constant MUSDC = 0xdC37BdfDf525769f96d46728aC8caC82823b69D3; // 6

    function run() public {
        vm.startBroadcast();
        address me = msg.sender;

        // approvals for the router (pulls the input token on each swap)
        IERC20(MWETH).approve(address(swapRouter), type(uint256).max);
        IERC20(MWBTC).approve(address(swapRouter), type(uint256).max);
        IERC20(MUSDC).approve(address(swapRouter), type(uint256).max);

        // (tokenA, tokenB, zeroForOne, humanUnitsOfInputToken)
        _swap(MWETH, MWBTC, true, 12, me);
        _swap(MWETH, MWBTC, false, 6, me);
        _swap(MWETH, MUSDC, true, 15, me);
        _swap(MWETH, MUSDC, false, 8, me);
        _swap(MWBTC, MUSDC, true, 10, me);
        _swap(MWBTC, MUSDC, false, 5, me);

        vm.stopBroadcast();
    }

    function _swap(address a, address b, bool zeroForOne, uint256 humanIn, address to) internal {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(HOOK));
        address inTok = zeroForOne ? t0 : t1;
        uint256 amountIn = humanIn * (10 ** IERC20(inTok).decimals());
        swapRouter.swapExactTokensForTokens(amountIn, 0, zeroForOne, key, "", to, block.timestamp + 3600);
        console2.log("SWAP", zeroForOne ? "0->1" : "1->0", amountIn);
    }
}
