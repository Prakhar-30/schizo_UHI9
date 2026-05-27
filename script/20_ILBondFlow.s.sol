// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {IPermit2} from "permit2/src/interfaces/IPermit2.sol";

import {ILBondHook} from "../src/ILBondHook.sol";
import {MockERC20} from "../src/MockERC20.sol";

/// @notice One-shot Sepolia setup for the ILBond flow, broadcast by Wallet1 (the LP).
///         Deploys the hook (CREATE2), ALPHA/BETA tokens, mints + approves, initializes
///         the V4 dynamic-fee pool, seeds base liquidity, and opens IL-bond position 0.
contract ILBondFlow is Script {
    IPoolManager constant poolManager = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant positionManager = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant swapRouter = 0xf13D190e9117920c703d79B5F33732e10049b115;
    IPermit2 constant permit2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    address constant CALLBACK_PROXY = 0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA;

    address constant W1 = 0x49aBE186a9B24F73E34cCAe3D179299440c352aC; // LP / FEE-T holder
    address constant W2 = 0xcD46C4C833725bC46b8aA4136BCdd35b615b5BC5; // IL-T buyer

    function run() public {
        // ── Mine the hook address (off-chain) ──
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        bytes memory ctorArgs = abi.encode(poolManager, CALLBACK_PROXY);
        (address hookAddr, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(ILBondHook).creationCode, ctorArgs);

        vm.startBroadcast();

        // 1) Deploy hook
        ILBondHook hook = new ILBondHook{salt: salt}(poolManager, CALLBACK_PROXY);
        require(address(hook) == hookAddr, "hook addr mismatch");

        // 2) Deploy + order tokens
        MockERC20 a = new MockERC20("IL Bond ALPHA", "ALPHA", 18);
        MockERC20 b = new MockERC20("IL Bond BETA", "BETA", 18);
        (MockERC20 t0, MockERC20 t1) = address(a) < address(b) ? (a, b) : (b, a);

        // 3) Mint: LP gets a big stack, W2 gets enough token1 for the premium
        t0.mint(W1, 1_000_000e18);
        t1.mint(W1, 1_000_000e18);
        t0.mint(W2, 1_000e18);
        t1.mint(W2, 1_000e18);

        // 4) Approvals (LP side)
        t0.approve(address(permit2), type(uint256).max);
        t1.approve(address(permit2), type(uint256).max);
        t0.approve(address(hook), type(uint256).max);
        t1.approve(address(hook), type(uint256).max);
        t0.approve(swapRouter, type(uint256).max);
        t1.approve(swapRouter, type(uint256).max);
        permit2.approve(address(t0), positionManager, type(uint160).max, type(uint48).max);
        permit2.approve(address(t1), positionManager, type(uint160).max, type(uint48).max);
        permit2.approve(address(t0), swapRouter, type(uint160).max, type(uint48).max);
        permit2.approve(address(t1), swapRouter, type(uint160).max, type(uint48).max);

        // 5) Initialize the dynamic-fee pool at 1:1
        PoolKey memory poolKey = PoolKey(
            Currency.wrap(address(t0)), Currency.wrap(address(t1)),
            LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook))
        );
        poolManager.initialize(poolKey, Constants.SQRT_PRICE_1_1);

        int24 tickLower = TickMath.minUsableTick(60);
        int24 tickUpper = TickMath.maxUsableTick(60);

        // 6) Seed base liquidity (100e18) via PositionManager
        {
            uint128 baseLiq = 100e18;
            (uint256 amt0, uint256 amt1) = LiquidityAmounts.getAmountsForLiquidity(
                Constants.SQRT_PRICE_1_1,
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                baseLiq
            );
            bytes memory actions = abi.encodePacked(
                uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP), uint8(Actions.SWEEP)
            );
            bytes[] memory params = new bytes[](4);
            params[0] = abi.encode(poolKey, tickLower, tickUpper, baseLiq, amt0 + 1, amt1 + 1, W1, "");
            params[1] = abi.encode(Currency.wrap(address(t0)), Currency.wrap(address(t1)));
            params[2] = abi.encode(Currency.wrap(address(t0)), W1);
            params[3] = abi.encode(Currency.wrap(address(t1)), W1);
            IPositionManager(positionManager).modifyLiquidities(abi.encode(actions, params), block.timestamp + 3600);
        }

        // 7) Open IL-bond position 0: liquidity 10e18, premium 0.1 token1
        uint256 posId = hook.depositILBond(poolKey, tickLower, tickUpper, 10e18, 100e18, 100e18, 0.1e18);

        vm.stopBroadcast();

        console2.log("HOOK   ", address(hook));
        console2.log("TOKEN0 ", address(t0));
        console2.log("TOKEN1 ", address(t1));
        console2.log("POSID  ", posId);
    }
}
