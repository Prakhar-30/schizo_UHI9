// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {BaseScript} from "./base/BaseScript.sol";

import {ILBondHook} from "../src/ILBondHook.sol";

/// @notice Mines the address and deploys the ILBondHook contract
contract DeployILBondHookScript is BaseScript {
    function run() public {
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        );

        address callbackSender = vm.envAddress("CALLBACK_PROXY");

        bytes memory constructorArgs = abi.encode(poolManager, callbackSender);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(ILBondHook).creationCode, constructorArgs);

        vm.startBroadcast();
        ILBondHook hook = new ILBondHook{salt: salt}(poolManager, callbackSender);
        vm.stopBroadcast();

        require(address(hook) == hookAddress, "DeployILBondHook: Hook Address Mismatch");
    }
}
