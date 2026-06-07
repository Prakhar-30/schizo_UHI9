// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ILBondReactive} from "../../src/ILBondReactive.sol";

/// @notice Test-only subclass exposing ILBondReactive's internal IL math.
///         In Foundry the system contract address has no code, so AbstractReactive
///         detects `vm = true` and the constructor skips `service.subscribe`.
contract ILReactiveHarness is ILBondReactive {
    constructor(
        address _owner,
        address _callbackContract,
        uint256 _destChainId,
        uint256 _swapTopic,
        uint256 _positionCreatedTopic,
        uint256 _positionExitedTopic,
        uint256 _ilBondDataBundleTopic
    )
        ILBondReactive(
            _owner,
            _callbackContract,
            _destChainId,
            _swapTopic,
            _positionCreatedTopic,
            _positionExitedTopic,
            _ilBondDataBundleTopic
        )
    {}

    function exposed_computeILMark(PositionData memory p)
        external
        pure
        returns (int256 ilBps, uint256 markValue)
    {
        return _computeILMark(p);
    }

    function exposed_computeILMark(
        uint256 positionId,
        uint160 entrySqrt,
        uint160 currentSqrt,
        uint128 liquidity
    ) external pure returns (int256 ilBps, uint256 markValue) {
        PositionData memory p = PositionData({
            positionId: positionId,
            entrySqrtPriceX96: entrySqrt,
            currentSqrtPriceX96: currentSqrt,
            sqrtPriceLower: 0,
            sqrtPriceUpper: 0,
            liquidity: liquidity
        });
        return _computeILMark(p);
    }
}
