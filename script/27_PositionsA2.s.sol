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

/// @notice A2 buys the demo IL-T (posId 0), then opens 2 positions it does NOT sell.
contract PositionsA2 is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;
    IPoolManager constant PM = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    ILBondHook constant HOOK = ILBondHook(payable(0x57696AB5077Aa634c13682C3d3E84287935290c0));

    address constant WBTC = 0x912A7Fb66391eAe95DDee40B664FF497108580CD;
    address constant LINK = 0x160fC2D6a542565ba7C2a57E18d6b28F62C8D0C7;
    address constant UNI = 0xCbAcA08f7eB9eB07537F344EbeC7E79302F60823;
    address constant AAVE = 0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba;
    address constant GHO = 0x00A311cd8BE35953635b0Bc619bdC807782dfC5E;

    address me;
    int24 tl;
    int24 tu;

    function run() public {
        vm.startBroadcast();
        me = msg.sender;
        tl = TickMath.minUsableTick(SPACING);
        tu = TickMath.maxUsableTick(SPACING);

        // 1) buy the demo IL-T (posId 0) - premium is in WBTC (demo currency1)
        IMintable(WBTC).mint(me, 10 * 1e8);
        IERC20(WBTC).approve(address(HOOK), type(uint256).max);
        HOOK.buyILBond(0);
        console2.log("BOUGHT_DEMO_ILT posId 0 by", me);

        // 2) two positions A2 keeps (does not sell IL-T)
        uint256 p1 = _deposit(LINK, UNI);
        console2.log("A2_POSITION", p1);
        uint256 p2 = _deposit(AAVE, GHO);
        console2.log("A2_POSITION", p2);

        vm.stopBroadcast();
    }

    function _deposit(address a, address b) internal returns (uint256) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        uint8 d0 = IERC20(t0).decimals();
        uint8 d1 = IERC20(t1).decimals();
        IMintable(t0).mint(me, 1000 * (10 ** d0));
        IMintable(t1).mint(me, 1000 * (10 ** d1));
        IERC20(t0).approve(address(HOOK), type(uint256).max);
        IERC20(t1).approve(address(HOOK), type(uint256).max);

        PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(address(HOOK)));
        (uint160 sp,,,) = PM.getSlot0(key.toId());
        uint256 raw0 = 20 * (10 ** d0);
        uint256 raw1 = 20 * (10 ** d1);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sp, TickMath.getSqrtPriceAtTick(tl), TickMath.getSqrtPriceAtTick(tu), raw0, raw1
        );
        uint256 premium = 1 * (10 ** d1);
        return HOOK.depositILBond(key, tl, tu, liq, raw0 + 1e6, raw1 + 1e6, premium);
    }
}
