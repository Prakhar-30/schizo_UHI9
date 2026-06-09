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
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";

import {BaseScript} from "./base/BaseScript.sol";
import {ILBondHook} from "../src/ILBondHook.sol";
import {MockERC20} from "../src/MockERC20.sol";

/// @notice Small, self-contained ILBondHook deployment for Unichain Sepolia (1301):
///         fresh hook + 3 mintable mock tokens + 3 pairs (seeded) + 2 open positions.
///         The Reactive contract is deployed separately on Lasna (forge create) and
///         points its callbacks back at the hook printed here.
///
///   forge script script/30_UnichainDeploy.s.sol --rpc-url https://sepolia.unichain.org \
///       --private-key $KEY --broadcast --slow
contract UnichainDeploy is BaseScript {
    using PoolIdLibrary for PoolKey;

    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;
    int256 constant TICKS_PER_DECADE = 23027;
    uint256 constant SEED = 150;       // human units/side of base liquidity
    uint256 constant POS_UNITS = 20;   // human units/side backing each opened position
    // Unichain Sepolia reactive callback proxy (authorized sender for hook callbacks).
    address constant DEFAULT_CALLBACK_PROXY = 0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4;

    ILBondHook hook;
    int24 tickLower;
    int24 tickUpper;
    address me;

    MockERC20[3] tokens;

    function run() public {
        address callbackProxy = vm.envOr("CALLBACK_PROXY", DEFAULT_CALLBACK_PROXY);
        tickLower = TickMath.minUsableTick(SPACING);
        tickUpper = TickMath.maxUsableTick(SPACING);

        vm.startBroadcast();
        me = msg.sender;

        // 1) hook (CREATE2, mined for the permission-flag bits)
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        bytes memory args = abi.encode(poolManager, callbackProxy);
        (address hookAddr, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(ILBondHook).creationCode, args);
        hook = new ILBondHook{salt: salt}(poolManager, callbackProxy);
        require(address(hook) == hookAddr, "hook addr mismatch");
        console2.log("HOOK", address(hook));

        // 2) 3 fresh mintable tokens, varied decimals (18 / 8 / 6)
        tokens[0] = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        tokens[1] = new MockERC20("Mock Wrapped BTC", "mWBTC", 8);
        tokens[2] = new MockERC20("Mock USD Coin", "mUSDC", 6);
        for (uint256 i; i < 3; ++i) {
            console2.log(tokens[i].symbol(), address(tokens[i]));
            tokens[i].mint(me, 1_000_000 * (10 ** tokens[i].decimals()));
            IERC20(address(tokens[i])).approve(address(permit2), type(uint256).max);
            permit2.approve(address(tokens[i]), address(positionManager), type(uint160).max, type(uint48).max);
            IERC20(address(tokens[i])).approve(address(hook), type(uint256).max);
        }

        // 3) every pair (C(3,2) = 3), each initialized + seeded
        _pool(address(tokens[0]), address(tokens[1])); // mWETH / mWBTC
        _pool(address(tokens[0]), address(tokens[2])); // mWETH / mUSDC
        _pool(address(tokens[1]), address(tokens[2])); // mWBTC / mUSDC

        // 4) open 2 IL-bond positions (left unsold so they're buyable in Hunt)
        uint256 p0 = _openPosition(address(tokens[0]), address(tokens[2])); // mWETH/mUSDC
        uint256 p1 = _openPosition(address(tokens[1]), address(tokens[2])); // mWBTC/mUSDC
        console2.log("POSITION_0", p0);
        console2.log("POSITION_1", p1);

        // 5) fund the hook so it can pay for reactive callbacks (AbstractPayer)
        (bool ok,) = address(hook).call{value: 0.05 ether}("");
        require(ok, "hook fund failed");
        console2.log("HOOK_FUNDED_WEI", uint256(0.05 ether));

        vm.stopBroadcast();
    }

    function _initSqrt(uint8 d0, uint8 d1) internal pure returns (uint160) {
        int256 k = int256(uint256(d1)) - int256(uint256(d0));
        int24 tick = int24((k * TICKS_PER_DECADE) / SPACING) * SPACING;
        return TickMath.getSqrtPriceAtTick(tick);
    }

    function _key(address a, address b) internal view returns (PoolKey memory key, uint8 d0, uint8 d1, uint160 sp) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        d0 = IERC20(t0).decimals();
        d1 = IERC20(t1).decimals();
        sp = _initSqrt(d0, d1);
        key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(address(hook)));
    }

    function _pool(address a, address b) internal {
        (PoolKey memory key, uint8 d0, uint8 d1, uint160 sp) = _key(a, b);
        poolManager.initialize(key, sp);

        uint256 raw0 = SEED * (10 ** d0);
        uint256 raw1 = SEED * (10 ** d1);
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
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp + 3600);
        console2.log("POOL", vm.toString(PoolId.unwrap(key.toId())));
    }

    function _openPosition(address a, address b) internal returns (uint256 pid) {
        (PoolKey memory key, uint8 d0, uint8 d1, uint160 sp) = _key(a, b);
        uint256 raw0 = POS_UNITS * (10 ** d0);
        uint256 raw1 = POS_UNITS * (10 ** d1);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sp, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), raw0, raw1
        );
        uint256 premium = 1 * (10 ** d1); // 1 whole unit of currency1
        pid = hook.depositILBond(key, tickLower, tickUpper, liq, raw0 + 1e6, raw1 + 1e6, premium);
    }
}
