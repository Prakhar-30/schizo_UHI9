# MandateMMHook — Full Sepolia Deployment & Demo

End-to-end deployment of the Dual-Layer IL Protection system on Sepolia testnet.

## Architecture

```
Sepolia (Chain 11155111)                    Reactive Lasna (Chain 5318007)
┌─────────────────────────────┐             ┌──────────────────────────┐
│  MockERC20 (Token A)        │             │  MandateMMReactive (RC)  │
│  MockERC20 (Token B)        │             │  ├─ Subscribes to events │
│  MandateMMHook (Hook + CC)  │◄── cron ────│  ├─ Cron100 (~12 min)   │
│  Uniswap V4 Pool            │             │  └─ Lazy cron lifecycle  │
└─────────────────────────────┘             └──────────────────────────┘
```

---

## Prerequisites

```bash
foundryup
forge install
```

## Environment Variables

```bash
export PRIVATE_KEY=<your_private_key>
export DEPLOYER_ADDR=$(cast wallet address --private-key $PRIVATE_KEY)
export SEPOLIA_RPC=<your_sepolia_rpc_url>
export REACTIVE_RPC=https://lasna-rpc.rnk.dev/

# Sepolia V4 canonical addresses
export POOL_MANAGER=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
export POSITION_MANAGER=0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4
export SWAP_ROUTER=0xf13D190e9117920c703d79B5F33732e10049b115
export PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3

# Reactive Network
export CALLBACK_PROXY_SEPOLIA=0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA
```

---

## Step 1: Deploy Mock ERC20 Tokens

```bash
# Deploy Token A
forge create src/MockERC20.sol:MockERC20 \
  --constructor-args "Token Alpha" "ALPHA" 18 \
  --rpc-url $SEPOLIA_RPC \
  --private-key $PRIVATE_KEY

export TOKEN_A=<deployed_address>

# Deploy Token B
forge create src/MockERC20.sol:MockERC20 \
  --constructor-args "Token Beta" "BETA" 18 \
  --rpc-url $SEPOLIA_RPC \
  --private-key $PRIVATE_KEY

export TOKEN_B=<deployed_address>

# Sort tokens (currency0 < currency1 required by V4)
# Compare addresses — the lower address is TOKEN0
# Use: python3 -c "print('TOKEN_A is token0' if int('$TOKEN_A',16) < int('$TOKEN_B',16) else 'TOKEN_B is token0')"
export TOKEN0=<lower_address>
export TOKEN1=<higher_address>
```

### Mint tokens to your wallet

```bash
# Mint 1,000,000 of each token
cast send $TOKEN0 "mint(address,uint256)" $DEPLOYER_ADDR 1000000000000000000000000 \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

cast send $TOKEN1 "mint(address,uint256)" $DEPLOYER_ADDR 1000000000000000000000000 \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

# Verify balances
cast call $TOKEN0 "balanceOf(address)(uint256)" $DEPLOYER_ADDR --rpc-url $SEPOLIA_RPC
cast call $TOKEN1 "balanceOf(address)(uint256)" $DEPLOYER_ADDR --rpc-url $SEPOLIA_RPC
```

---

## Step 2: Deploy MandateMMHook (CREATE2 Salt Mining)

The hook address must have specific flag bits set. Use the deployment script:

```bash
# Set the callback proxy env var for the deploy script
export CALLBACK_PROXY=$CALLBACK_PROXY_SEPOLIA

forge script script/00_DeployMandateMMHook.s.sol \
  --rpc-url $SEPOLIA_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast

export HOOK=<deployed_hook_address>
```

### Verify hook address has correct flags

```bash
# The hook address should have bits 6 (AFTER_SWAP), 7 (BEFORE_SWAP), 12 (AFTER_INITIALIZE) set
python3 -c "addr=int('$HOOK',16); print(f'afterInit: {bool(addr & (1<<12))}, beforeSwap: {bool(addr & (1<<7))}, afterSwap: {bool(addr & (1<<6))}')"
```

---

## Step 3: Initialize Pool

```bash
# Initialize pool via PoolManager
# Fee = 0x800000 (DYNAMIC_FEE_FLAG) | tickSpacing = 60
# sqrtPriceX96 for 1:1 = 79228162514264337593543950336

cast send $POOL_MANAGER \
  "initialize((address,address,uint24,int24,address),uint160)" \
  "($TOKEN0,$TOKEN1,8388608,60,$HOOK)" \
  79228162514264337593543950336 \
  --rpc-url $SEPOLIA_RPC \
  --private-key $PRIVATE_KEY
```

> Note: `8388608` = `0x800000` = `DYNAMIC_FEE_FLAG`

---

## Step 4: Seed Base Liquidity (via PositionManager)

```bash
# Approve tokens to Permit2
cast send $TOKEN0 "approve(address,uint256)" $PERMIT2 $(cast max-uint) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

cast send $TOKEN1 "approve(address,uint256)" $PERMIT2 $(cast max-uint) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

# Approve Permit2 to PositionManager
cast send $PERMIT2 "approve(address,address,uint160,uint48)" \
  $TOKEN0 $POSITION_MANAGER $(cast max-uint160) $(cast max-uint48) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

cast send $PERMIT2 "approve(address,address,uint160,uint48)" \
  $TOKEN1 $POSITION_MANAGER $(cast max-uint160) $(cast max-uint48) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY
```

> For adding base liquidity, use the `script/01_CreatePoolAndAddLiquidity.s.sol` after updating `BaseScript.sol` with your token addresses and hook address.

---

## Step 5: Deposit with Mandate (LP uses the hook vault)

```bash
# Approve tokens to the hook (for depositWithMandate)
cast send $TOKEN0 "approve(address,uint256)" $HOOK $(cast max-uint) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

cast send $TOKEN1 "approve(address,uint256)" $HOOK $(cast max-uint) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

# Deposit with mandate:
#   liquidity: 10e18 (10000000000000000000)
#   amount0Max: 100e18
#   amount1Max: 100e18
#   mandate: (maxILBps=500, step1Bps=200, step1Pct=50, step2Bps=350, step2Pct=75)
cast send $HOOK \
  "depositWithMandate((address,address,uint24,int24,address),int24,int24,uint128,uint256,uint256,(uint256,uint256,uint256,uint256,uint256))" \
  "($TOKEN0,$TOKEN1,8388608,60,$HOOK)" \
  -887220 \
  887220 \
  10000000000000000000 \
  100000000000000000000 \
  100000000000000000000 \
  "(500,200,50,350,75)" \
  --rpc-url $SEPOLIA_RPC \
  --private-key $PRIVATE_KEY

# Check position was created
cast call $HOOK "activePositionCount()(uint256)" --rpc-url $SEPOLIA_RPC
cast call $HOOK "getPosition(uint256)(address,bool,uint128,uint128,uint160,bool,bool)" 0 --rpc-url $SEPOLIA_RPC
```

---

## Step 6: Simulate Swaps (Move Price, Create IL)

```bash
# Approve tokens to swap router
cast send $TOKEN0 "approve(address,uint256)" $SWAP_ROUTER $(cast max-uint) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

cast send $TOKEN1 "approve(address,uint256)" $SWAP_ROUTER $(cast max-uint) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

# Also approve via Permit2 to swap router
cast send $PERMIT2 "approve(address,address,uint160,uint48)" \
  $TOKEN0 $SWAP_ROUTER $(cast max-uint160) $(cast max-uint48) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

cast send $PERMIT2 "approve(address,address,uint160,uint48)" \
  $TOKEN1 $SWAP_ROUTER $(cast max-uint160) $(cast max-uint48) \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY

# Large swap to move price (creates IL)
# swapExactTokensForTokens(uint256,uint256,bool,PoolKey,bytes,address,uint256)
cast send $SWAP_ROUTER \
  "swapExactTokensForTokens(uint256,uint256,bool,(address,address,uint24,int24,address),bytes,address,uint256)" \
  50000000000000000000 \
  0 \
  true \
  "($TOKEN0,$TOKEN1,8388608,60,$HOOK)" \
  "0x" \
  $DEPLOYER_ADDR \
  $(cast block latest --field timestamp --rpc-url $SEPOLIA_RPC | xargs -I{} echo "{}+3600" | bc) \
  --rpc-url $SEPOLIA_RPC \
  --private-key $PRIVATE_KEY

# Check IL on position
cast call $HOOK "getCurrentIL(uint256)(uint256)" 0 --rpc-url $SEPOLIA_RPC
```

---

## Step 7: Deploy Reactive Contract

### Compute event topic hashes

```bash
export MANDATE_CONFIGURED_TOPIC=$(cast keccak "MandateConfigured(uint256,address,uint256)")
export POSITION_EXITED_TOPIC=$(cast keccak "PositionExited(uint256)")
export CHECK_CYCLE_TOPIC=$(cast keccak "CheckCycleCompleted(uint256,uint256,uint256)")

echo "MandateConfigured: $MANDATE_CONFIGURED_TOPIC"
echo "PositionExited:    $POSITION_EXITED_TOPIC"
echo "CheckCycle:        $CHECK_CYCLE_TOPIC"
```

### Get lREACT tokens

```bash
export SEPOLIA_FAUCET=0x9b9BB25f1A81078C544C829c5EB7822d747Cf434
cast send $SEPOLIA_FAUCET --value 1ether \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY
```

### Deploy RC on Reactive Lasna

```bash
export DEST_CHAIN_ID=11155111

forge create src/MandateMMReactive.sol:MandateMMReactive \
  --constructor-args \
    $DEPLOYER_ADDR \
    $HOOK \
    $DEST_CHAIN_ID \
    $MANDATE_CONFIGURED_TOPIC \
    $POSITION_EXITED_TOPIC \
    $CHECK_CYCLE_TOPIC \
  --value 0.1ether \
  --rpc-url $REACTIVE_RPC \
  --private-key $PRIVATE_KEY

export RC_ADDRESS=<deployed_rc_address>
```

### Verify RC is active

```
https://lasna.reactscan.net/address/<RC_ADDRESS>
```

---

## Step 8: Wait for RC Cron & Verify Enforcement

The RC fires every ~12 minutes (Cron100). When it fires:
1. RC emits `Callback` to hook's `checkMandates()`
2. Hook computes IL for each position
3. If IL > mandate threshold → auto-exits liquidity
4. Tokens become withdrawable

### Monitor

```bash
# Check IL
cast call $HOOK "getCurrentIL(uint256)(uint256)" 0 --rpc-url $SEPOLIA_RPC

# Check position status after cron fires
cast call $HOOK "getPosition(uint256)(address,bool,uint128,uint128,uint160,bool,bool)" 0 --rpc-url $SEPOLIA_RPC

# Check withdrawable balance
cast call $HOOK "getWithdrawable(address)(uint256,uint256)" $DEPLOYER_ADDR --rpc-url $SEPOLIA_RPC
```

### Manual trigger (before RC is live)

If you want to test mandate enforcement without waiting for the RC:

```bash
# Add your own address as authorized sender (for testing only)
# The hook uses authorizedSenderOnly — in production, only the Callback Proxy can call
# For manual testing, call from the CALLBACK_PROXY address (requires simulation)

# Alternative: use cast with --from to simulate (anvil only)
# On live Sepolia, wait for the RC cron to trigger it
```

---

## Step 9: Withdraw Tokens After Exit

```bash
cast send $HOOK "withdraw(address)" $TOKEN0 \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY
```

---

## Demo Flow Summary

```
1. Deploy tokens → ALPHA, BETA
2. Deploy hook → MandateMMHook at flag-encoded address
3. Create V4 pool with dynamic fees + hook
4. Seed base liquidity
5. LP deposits 10 ETH worth with mandate: "exit at 5% IL, reduce 50% at 2% IL"
6. Swaps push price → IL accumulates
7. RC cron fires → checkMandates() → detects IL > 2% → removes 50% liquidity
8. More swaps → IL hits 5% → RC fires again → full exit
9. LP withdraws tokens — protected from further IL
```

---

## Contract Addresses Reference

| Contract | Sepolia Address |
|----------|----------------|
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| PositionManager | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` |
| SwapRouter | `0xf13D190e9117920c703d79B5F33732e10049b115` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Callback Proxy (Sepolia) | `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA` |
| Reactive RPC | `https://lasna-rpc.rnk.dev/` |
