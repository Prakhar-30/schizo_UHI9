// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";

import {BaseScript} from "./base/BaseScript.sol";
import {ILBondHook} from "../src/ILBondHook.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @notice Fresh self-contained hook (v5, no external dependencies) + all 45 pair
///         combinations across the 10 existing tokens, each seeded with ~150
///         human units/side. Tokens are reused.
contract FreshDeploy is BaseScript {
    using PoolIdLibrary for PoolKey;

    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;
    int256 constant TICKS_PER_DECADE = 23027;
    uint256 constant HUMAN = 150; // liquidity units per side

    // Existing tokens (6 custom mintable + 4 real). Order is fixed so the
    // frontend can regenerate the same 45 combinations.
    address[10] TOKENS = [
        0x748b5C9623528D346C414F4f236B3b5b5c7683cb, // WETH 18 custom
        0x912A7Fb66391eAe95DDee40B664FF497108580CD, // WBTC 8  custom
        0x160fC2D6a542565ba7C2a57E18d6b28F62C8D0C7, // LINK 18 custom
        0xCbAcA08f7eB9eB07537F344EbeC7E79302F60823, // UNI  18 custom
        0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba, // AAVE 18 custom
        0x00A311cd8BE35953635b0Bc619bdC807782dfC5E, // GHO  18 custom
        0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357, // DAI  18 real
        0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E, // EURS 2  real
        0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8, // USDC 6  real
        0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0  // USDT 6  real
    ];
    uint256 constant N_CUSTOM = 6; // first 6 are mintable

    ILBondHook hook;
    int24 tickLower;
    int24 tickUpper;
    address me;
    uint256 created;

    function run() public {
        tickLower = TickMath.minUsableTick(SPACING);
        tickUpper = TickMath.maxUsableTick(SPACING);

        vm.startBroadcast();
        me = msg.sender;

        // 1) fresh hook (fully self-contained: no callback proxy, nothing to fund)
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        bytes memory args = abi.encode(poolManager);
        (address hookAddr, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(ILBondHook).creationCode, args);
        hook = new ILBondHook{salt: salt}(poolManager);
        require(address(hook) == hookAddr, "hook addr mismatch");
        console2.log("HOOK", address(hook));

        // 2) top up mintable customs + approvals for all 10
        for (uint256 i; i < TOKENS.length; ++i) {
            address t = TOKENS[i];
            if (i < N_CUSTOM) {
                IMintable(t).mint(me, 100_000 * (10 ** IERC20(t).decimals()));
            }
            IERC20(t).approve(address(permit2), type(uint256).max);
            permit2.approve(t, address(positionManager), type(uint160).max, type(uint48).max);
        }

        // 3) every pair combination
        for (uint256 i; i < TOKENS.length; ++i) {
            for (uint256 j = i + 1; j < TOKENS.length; ++j) {
                _pool(TOKENS[i], TOKENS[j]);
            }
        }

        vm.stopBroadcast();
        console2.log("PAIRS_CREATED", created);
    }

    function _initSqrt(uint8 d0, uint8 d1) internal pure returns (uint160) {
        int256 k = int256(uint256(d1)) - int256(uint256(d0));
        int24 tick = int24((k * TICKS_PER_DECADE) / SPACING) * SPACING;
        return TickMath.getSqrtPriceAtTick(tick);
    }

    function _pool(address a, address b) internal {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        uint8 d0 = IERC20(t0).decimals();
        uint8 d1 = IERC20(t1).decimals();
        uint160 sp = _initSqrt(d0, d1);
        PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(address(hook)));

        try poolManager.initialize(key, sp) returns (int24) {} catch {
            console2.log("INIT_FAIL", t0, t1);
            return;
        }

        uint256 raw0 = HUMAN * (10 ** d0);
        uint256 raw1 = HUMAN * (10 ** d1);

        // Skip seeding when the deployer can't cover a side: a reverting call
        // inside try/catch still lands in the broadcast queue and fails the
        // whole simulation, so the check must happen before the call.
        if (IERC20(t0).balanceOf(me) < raw0 + 1e6 || IERC20(t1).balanceOf(me) < raw1 + 1e6) {
            console2.log("SEED_SKIP", t0, t1);
            return;
        }

        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sp, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), raw0, raw1
        );

        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP), uint8(Actions.SWEEP)
        );
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(key, tickLower, tickUpper, liq, raw0 + 1e6, raw1 + 1e6, me, "");
        params[1] = abi.encode(key.currency0, key.currency1);
        params[2] = abi.encode(key.currency0, me);
        params[3] = abi.encode(key.currency1, me);

        try positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp + 3600) {
            created++;
            console2.log("POOL", t0, t1);
        } catch {
            console2.log("SEED_FAIL", t0, t1);
        }
    }
}
