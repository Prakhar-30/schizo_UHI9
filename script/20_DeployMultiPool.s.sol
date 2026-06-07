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
import {MockERC20} from "../src/MockERC20.sol";

/// @notice One-shot multi-pool deploy: ILBondHook + custom ERC20s, then creates
///         and seeds a basket of dynamic-fee pools across mixed token decimals.
contract DeployMultiPool is BaseScript {
    using PoolIdLibrary for PoolKey;

    uint24 constant DYN = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant SPACING = 60;
    // ln(10)/ln(1.0001) — ticks per 10x price move.
    int256 constant TICKS_PER_DECADE = 23027;
    address constant DEFAULT_CALLBACK_PROXY = 0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA;

    // Real Sepolia tokens (deployer already holds balances).
    address constant DAI = 0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357;  // 18
    address constant EURS = 0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E; // 2
    address constant USDC = 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8; // 6
    address constant USDT = 0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0; // 6

    ILBondHook hook;
    int24 tickLower;
    int24 tickUpper;
    address me;

    function run() public {
        address callbackProxy = vm.envOr("CALLBACK_PROXY", DEFAULT_CALLBACK_PROXY);
        tickLower = TickMath.minUsableTick(SPACING);
        tickUpper = TickMath.maxUsableTick(SPACING);

        vm.startBroadcast();
        me = msg.sender;

        // 1) Hook (mined for permission flags).
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        bytes memory args = abi.encode(poolManager, callbackProxy);
        (address hookAddr, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(ILBondHook).creationCode, args);
        hook = new ILBondHook{salt: salt}(poolManager, callbackProxy);
        require(address(hook) == hookAddr, "hook addr mismatch");
        console2.log("HOOK", address(hook));

        // 2) Custom ERC20s (mintable, varied decimals).
        address weth = _token("Wrapped Ether", "WETH", 18);
        address wbtc = _token("Wrapped BTC", "WBTC", 8);
        address link = _token("Chainlink", "LINK", 18);
        address uni = _token("Uniswap", "UNI", 18);
        address aave = _token("Aave Token", "AAVE", 18);
        address gho = _token("Gho Stablecoin", "GHO", 18);

        // 3) Approvals for the real tokens (customs are approved in _token()).
        _approve(DAI);
        _approve(EURS);
        _approve(USDC);
        _approve(USDT);

        // 4) Pools (1000 human units of each side).
        _pool(weth, USDC, 1000);
        _pool(wbtc, USDT, 1000);
        _pool(weth, DAI, 1000);
        _pool(link, weth, 1000);
        _pool(uni, weth, 1000);
        _pool(aave, weth, 1000);
        _pool(gho, DAI, 1000);
        _pool(wbtc, weth, 1000);
        _pool(eurs_pair(), weth, 1000); // EURS / WETH
        _pool(USDC, DAI, 1000);

        vm.stopBroadcast();
    }

    function eurs_pair() internal pure returns (address) {
        return EURS;
    }

    function _token(string memory name, string memory sym, uint8 dec) internal returns (address) {
        MockERC20 t = new MockERC20(name, sym, dec);
        t.mint(me, 1_000_000 * (10 ** dec));
        _approve(address(t));
        console2.log(sym, address(t));
        return address(t);
    }

    function _approve(address token) internal {
        IERC20(token).approve(address(permit2), type(uint256).max);
        permit2.approve(token, address(positionManager), type(uint160).max, type(uint48).max);
    }

    /// Initial sqrtPrice so that 1 human token0 ~= 1 human token1 (decimal-adjusted).
    /// price (token1/token0, raw) = 10^(d1 - d0)  ->  tick = (d1-d0)*TICKS_PER_DECADE.
    function _initSqrt(uint8 d0, uint8 d1) internal pure returns (uint160) {
        int256 k = int256(uint256(d1)) - int256(uint256(d0));
        int24 tick = int24((k * TICKS_PER_DECADE) / SPACING) * SPACING;
        return TickMath.getSqrtPriceAtTick(tick);
    }

    function _pool(address a, address b, uint256 human) internal {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        uint8 d0 = IERC20(t0).decimals();
        uint8 d1 = IERC20(t1).decimals();

        uint160 sp = _initSqrt(d0, d1);
        PoolKey memory key =
            PoolKey(Currency.wrap(t0), Currency.wrap(t1), DYN, SPACING, IHooks(address(hook)));
        poolManager.initialize(key, sp);

        uint256 raw0 = human * (10 ** d0);
        uint256 raw1 = human * (10 ** d1);
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

        console2.log("POOL", t0, t1);
        console2.logBytes32(PoolId.unwrap(key.toId()));
    }
}
