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

/// @notice Mints IL-bond positions (LP = broadcaster) on a few pools so the hook
///         has positions to mark. Buyers take the IL-T leg separately (cast).
contract MintPositions is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;
    IPoolManager constant PM = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    ILBondHook constant HOOK = ILBondHook(payable(0x57696AB5077Aa634c13682C3d3E84287935290c0));

    address constant WETH = 0x748b5C9623528D346C414F4f236B3b5b5c7683cb;
    address constant WBTC = 0x912A7Fb66391eAe95DDee40B664FF497108580CD;
    address constant AAVE = 0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba;
    address constant EURS = 0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E;

    int24 tickLower;
    int24 tickUpper;

    function run() public {
        tickLower = TickMath.minUsableTick(SPACING);
        tickUpper = TickMath.maxUsableTick(SPACING);
        vm.startBroadcast();
        _mint(WBTC, WETH, 3, 1); // 8/18 decimals
        _mint(AAVE, WETH, 3, 1); // 18/18
        _mint(EURS, WETH, 5, 1); // 2/18
        vm.stopBroadcast();
    }

    function _mint(address a, address b, uint256 human, uint256 premHuman) internal {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        uint8 d0 = IERC20(t0).decimals();
        uint8 d1 = IERC20(t1).decimals();
        PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(address(HOOK)));

        (uint160 sp,,,) = PM.getSlot0(key.toId());
        uint256 raw0 = human * (10 ** d0);
        uint256 raw1 = human * (10 ** d1);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sp, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), raw0, raw1
        );

        IERC20(t0).approve(address(HOOK), type(uint256).max);
        IERC20(t1).approve(address(HOOK), type(uint256).max);

        uint256 premium = premHuman * (10 ** d1); // premium paid in currency1
        uint256 posId = HOOK.depositILBond(key, tickLower, tickUpper, liq, raw0 + 1e6, raw1 + 1e6, premium);
        console2.log("POSITION", posId);
        console2.log("  pool t0/t1", t0, t1);
        console2.log("  premium currency1 raw", premium);
    }
}
