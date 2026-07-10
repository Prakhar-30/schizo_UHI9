// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ILBondHook} from "../src/ILBondHook.sol";

interface IMintable { function mint(address to, uint256 amount) external; }

/// @notice A1 opens an IL-bond position in the DEMO pool (WETH/WBTC). posId = 0.
contract DepositDemo is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;
    IPoolManager constant PM = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    ILBondHook constant HOOK = ILBondHook(payable(0x57696AB5077Aa634c13682C3d3E84287935290c0));
    address constant WETH = 0x748b5C9623528D346C414F4f236B3b5b5c7683cb;
    address constant WBTC = 0x912A7Fb66391eAe95DDee40B664FF497108580CD;

    function run() public {
        vm.startBroadcast();
        address me = msg.sender;
        int24 tl = TickMath.minUsableTick(SPACING);
        int24 tu = TickMath.maxUsableTick(SPACING);

        (address t0, address t1) = WETH < WBTC ? (WETH, WBTC) : (WBTC, WETH);
        uint8 d0 = IERC20(t0).decimals();
        uint8 d1 = IERC20(t1).decimals();
        PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(address(HOOK)));

        // ensure balances + approve the hook
        IMintable(t0).mint(me, 1000 * (10 ** d0));
        IMintable(t1).mint(me, 1000 * (10 ** d1));
        IERC20(t0).approve(address(HOOK), type(uint256).max);
        IERC20(t1).approve(address(HOOK), type(uint256).max);

        (uint160 sp,,,) = PM.getSlot0(key.toId());
        uint256 human = 20;
        uint256 raw0 = human * (10 ** d0);
        uint256 raw1 = human * (10 ** d1);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sp, TickMath.getSqrtPriceAtTick(tl), TickMath.getSqrtPriceAtTick(tu), raw0, raw1
        );

        uint256 premium = 1 * (10 ** d1); // 1 unit of currency1 (WBTC)
        uint256 posId = HOOK.depositILBond(key, tl, tu, liq, raw0 + 1e6, raw1 + 1e6, premium);
        console2.log("DEMO_POSITION", posId);
        console2.log("  premium currency1 raw", premium);
    }
}
