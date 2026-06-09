// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";

import {EasyPosm} from "./utils/libraries/EasyPosm.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {ILBondHook} from "../src/ILBondHook.sol";

/// @notice Drives random sequences of deposit / buy / exit / swap / withdraw.
contract ILBondHandler is Test {
    using CurrencyLibrary for Currency;

    ILBondHook public hook;
    IUniswapV4Router04 public router;
    PoolKey public key;
    address public t0;
    address public t1;
    int24 public tickLower;
    int24 public tickUpper;

    address[3] public actors;
    uint256[] public ids;
    mapping(uint256 => bool) public exitedGhost;

    constructor(ILBondHook _hook, IUniswapV4Router04 _router, PoolKey memory _key, int24 _tl, int24 _tu) {
        hook = _hook;
        router = _router;
        key = _key;
        t0 = Currency.unwrap(_key.currency0);
        t1 = Currency.unwrap(_key.currency1);
        tickLower = _tl;
        tickUpper = _tu;
        actors = [address(0xA11CE), address(0xB0B), address(0xC0C0)];

        IERC20Minimal(t0).approve(address(hook), type(uint256).max);
        IERC20Minimal(t1).approve(address(hook), type(uint256).max);
        IERC20Minimal(t0).approve(address(router), type(uint256).max);
        IERC20Minimal(t1).approve(address(router), type(uint256).max);
    }

    function actorsList() external view returns (address[3] memory) {
        return actors;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function deposit(uint256 liqSeed, uint256 ask) external {
        uint128 liq = uint128(bound(liqSeed, 1e12, 20e18));
        ask = bound(ask, 0, 5e18);
        deal(t0, address(this), 200e18);
        deal(t1, address(this), 200e18);
        uint256 pid = hook.depositILBond(key, tickLower, tickUpper, liq, 100e18, 100e18, ask);
        ids.push(pid);
    }

    function buy(uint256 idSeed, uint256 actorSeed) external {
        if (ids.length == 0) return;
        uint256 pid = ids[bound(idSeed, 0, ids.length - 1)];
        (,,, bool active, bool sold,,,,, uint256 ask) = hook.getPosition(pid);
        if (!active || sold || ask == 0) return;
        address actor = actors[bound(actorSeed, 0, 2)];
        deal(t1, actor, ask);
        vm.startPrank(actor);
        IERC20Minimal(t1).approve(address(hook), ask);
        hook.buyILBond(pid);
        vm.stopPrank();
    }

    function exit(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 pid = ids[bound(idSeed, 0, ids.length - 1)];
        (,,, bool active,,,,,,) = hook.getPosition(pid);
        if (!active) return;
        hook.exitPosition(pid); // handler is lp/feeHolder -> authorized
        exitedGhost[pid] = true;
    }

    function swap(uint256 amtSeed, bool dir) external {
        uint256 amt = bound(amtSeed, 1e12, 30e18);
        deal(dir ? t0 : t1, address(this), amt + 1);
        try router.swapExactTokensForTokens(amt, 0, dir, key, "", address(this), block.timestamp + 1) {} catch {}
    }

    function withdraw(uint256 actorSeed, bool token1side) external {
        address who = actorSeed % 4 == 0 ? address(this) : actors[bound(actorSeed, 0, 2)];
        Currency cur = token1side ? key.currency1 : key.currency0;
        if (hook.getClaimable(who, Currency.unwrap(cur)) == 0) return;
        vm.prank(who);
        hook.withdraw(cur);
    }
}

contract ILBondHookInvariant is BaseTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    ILBondHook hook;
    ILBondHandler handler;
    PoolKey key;
    PoolId id;
    address t0;
    address t1;
    int24 tickLower;
    int24 tickUpper;

    function setUp() public {
        deployArtifactsAndLabel();

        address flags = address(
            uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG)
                ^ (0x6666 << 144)
        );
        deployCodeTo("ILBondHook.sol:ILBondHook", abi.encode(poolManager, address(this)), flags);
        hook = ILBondHook(payable(flags));

        (Currency c0, Currency c1) = deployCurrencyPair();
        key = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        id = key.toId();
        poolManager.initialize(key, Constants.SQRT_PRICE_1_1);

        tickLower = TickMath.minUsableTick(60);
        tickUpper = TickMath.maxUsableTick(60);
        t0 = Currency.unwrap(c0);
        t1 = Currency.unwrap(c1);

        // Seed deep base liquidity so swaps execute.
        uint128 liq = 1000e18;
        (uint256 a0, uint256 a1) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liq
        );
        positionManager.mint(
            key, tickLower, tickUpper, liq, a0 + 1, a1 + 1, address(this), block.timestamp, Constants.ZERO_BYTES
        );

        handler = new ILBondHandler(hook, swapRouter, key, tickLower, tickUpper);
        targetContract(address(handler));
    }

    function _isActive(uint256 pid) internal view returns (bool a) {
        (,,, a,,,,,,) = hook.getPosition(pid);
    }

    /// activePositionCount equals the number of positions whose `active` flag is set.
    function invariant_activeCountMatchesFlags() public view {
        uint256 n = hook.nextPositionId();
        uint256 counted;
        for (uint256 i; i < n; ++i) {
            if (_isActive(i)) counted++;
        }
        assertEq(counted, hook.activePositionCount(), "active count == #active flags");
    }

    /// Every entry of the active set is active and unique.
    function invariant_activeSetIsCleanAndUnique() public view {
        uint256 cnt = hook.activePositionCount();
        for (uint256 i; i < cnt; ++i) {
            uint256 pid = hook.activePositionIds(i);
            assertTrue(_isActive(pid), "active set entry must be active");
            for (uint256 j = i + 1; j < cnt; ++j) {
                assertTrue(pid != hook.activePositionIds(j), "no duplicates in active set");
            }
        }
    }

    /// An exited position never reactivates.
    function invariant_exitedNeverReactivates() public view {
        uint256 len = handler.idsLength();
        for (uint256 i; i < len; ++i) {
            uint256 pid = handler.ids(i);
            if (handler.exitedGhost(pid)) {
                assertFalse(_isActive(pid), "exited stays inactive");
            }
        }
    }

    /// Every inactive (exited) position has had its liquidity zeroed.
    function invariant_inactiveHasZeroLiquidity() public view {
        uint256 n = hook.nextPositionId();
        for (uint256 i; i < n; ++i) {
            (,,, bool active,, uint128 liq,,,,) = hook.getPosition(i);
            if (!active) assertEq(liq, 0, "exited position must hold zero liquidity");
        }
    }

    /// The dynamic fee is always within [BASE_FEE, MAX_FEE].
    function invariant_feeAlwaysBounded() public view {
        uint24 f = hook.currentFee(id);
        assertGe(f, hook.BASE_FEE());
        assertLe(f, hook.MAX_FEE());
    }

    /// The hook always holds enough of each token to cover all outstanding claims.
    function invariant_claimableSolvency() public view {
        address[3] memory a = handler.actorsList();
        _solventFor(t0, a);
        _solventFor(t1, a);
    }

    function _solventFor(address token, address[3] memory a) internal view {
        uint256 owed = hook.getClaimable(address(handler), token);
        for (uint256 i; i < 3; ++i) {
            owed += hook.getClaimable(a[i], token);
        }
        assertLe(owed, IERC20Minimal(token).balanceOf(address(hook)), "hook solvent for claims");
    }
}
