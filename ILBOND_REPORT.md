# ILBondHook — Splitting an LP Position Into Yield (FEE-T) and Risk (IL-T) Legs
## Live Deployment & Validation Report

**Author:** Prakhar Srivastava
**Date:** May 27, 2026 (fresh two-wallet validation run)
**Networks:** Ethereum Sepolia + Reactive Network (Lasna Testnet)

---

## 1. Executive Summary

ILBondHook is the first Uniswap V4 hook to **decompose** a concentrated LP position into two independent, transferable claims: **FEE-T** (yield + upfront premium) and **IL-T** (impermanent-loss exposure). Every existing IL-protection hook tries to *reduce* IL. ILBondHook does not reduce IL — it lets one party hold the yield and another party hold the risk, with a market-priced premium changing hands at mint.

The IL mark for each position is recomputed on every swap by a Reactive Smart Contract on Lasna, using the standard `1 − 2√r/(1+r)` IL formula in the ReactVM. The result is posted back to the hook via callback so anyone can read each position's current IL on-chain in real time.

The system has been deployed end-to-end and validated on Sepolia + Reactive Network: real V4 liquidity was created, FEE-T + IL-T were minted, an IL-T buyer paid 0.1 BETA premium to the FEE-T holder, swaps moved the price into deep IL territory, the RC subscribed to the swap pipeline, and the two-phase relay (`prepareILBondData` → `ILBondDataBundle` → `settleILMark`) executed without human intervention.

---

## 2. Problem Statement

A Uniswap LP position is **always** a bundle of two heterogeneous exposures:

1. **Fee income** — slow, steady, vol-positive (more swaps → more fees).
2. **Impermanent loss** — driven by price moves; vol-negative (more vol → more IL).

Today there is no way to own one without the other. A conservative DAO treasury that wants stable yield can't get it without taking on price risk. A speculator who wants directional vol exposure has to also act as a market maker. The "LP product" forces a one-size-fits-all shape on every participant.

Every existing IL hook attacks the symptom — *reduce* IL. ILBondHook attacks the structural issue — *separate* IL from yield.

---

## 3. Solution Architecture

### 3.1 Two-Contract System

```
Sepolia (Chain 11155111)                    Reactive Network (Lasna 5318007)
┌──────────────────────────────────┐       ┌────────────────────────────────┐
│  ILBondHook                       │       │  ILBondReactive                │
│  (V4 Hook + Callback Contract)    │       │  (IL Mark-to-Market Engine)    │
│                                  │       │                                │
│  LP-FACING:                      │ events│  Subscribes to:                │
│  ├─ depositILBond                 │──────►│  ├─ SwapOccurred              │
│  │   (mint FEE-T + IL-T)          │       │  ├─ PositionCreated/Exited    │
│  ├─ buyILBond                     │       │  └─ ILBondDataBundle          │
│  │   (buyer pays premium for IL-T)│       │                                │
│  ├─ transferFeeToken              │       │  On every swap:                │
│  ├─ transferILToken               │       │  ├─ Callback prepareILBondData │
│  ├─ exitPosition / withdraw       │       │                                │
│                                  │       │  On bundle:                    │
│  RC-FACING:                      │       │  ├─ Decode positions + price   │
│  ├─ prepareILBondData             │       │  ├─ Compute IL = 1 − 2√r/(1+r) │
│  │   (packs price+positions into  │       │  └─ Callback settleILMark     │
│  │    ILBondDataBundle event)     │       │                                │
│  └─ settleILMark ◄────────────────┼───────┤  Lifecycle:                    │
│                                  │       │    activeCount tracking        │
│  V4 INTEGRATION:                 │       │                                │
│  ├─ afterInitialize / afterSwap  │       │                                │
│  ├─ beforeSwap (BASE_FEE = 30bps) │       │                                │
│  └─ unlockCallback for liquidity │       │                                │
└──────────────────────────────────┘       └────────────────────────────────┘
```

### 3.2 Data Flow

```
1. LP calls depositILBond(...)
   └─ Hook transfers tokens, calls poolManager.unlock()
   └─ Real V4 liquidity created via modifyLiquidity()
   └─ Position struct created with feeHolder = ilHolder = LP, askPremium set
   └─ Emits PositionCreated(positionId, owner, entrySqrtPriceX96)

2. RC sees PositionCreated → self-callback persistPositionAdded → activeCount++

3. IL-T buyer calls buyILBond(positionId)
   └─ Hook transfers premium from buyer in token1
   └─ Credits feeHolder's withdrawable[feeHolder].amount1
   └─ Sets ilHolder = buyer, ilBondSold = true
   └─ Emits ILBondSold + ILTokenTransferred

4. Pool swaps execute
   └─ Hook beforeSwap: returns BASE_FEE
   └─ Hook afterSwap: emits SwapOccurred(poolId, sqrtPrice, tick, liquidity)

5. RC sees SwapOccurred → emits Callback prepareILBondData(address(0))
   └─ Hook iterates activePositionIds, packs current price + each position
       (entrySqrtPrice, sqrtPriceLower, sqrtPriceUpper, liquidity)
   └─ Emits ILBondDataBundle(bundleId, bytes)

6. RC sees ILBondDataBundle → react() decodes inside ReactVM
   └─ For each position:
       sqrtR     = (currentSqrt / entrySqrtPrice) × PRECISION
       r         = sqrtR² / PRECISION
       num       = 2 × sqrtR × BPS
       denom     = PRECISION + r
       ratio     = num / denom
       il_bps    = max(0, BPS − ratio)
       ilBps     = -il_bps                  // signed: negative for IL-T holder loss
       markValue = liquidity × (BPS − il_bps) / BPS
   └─ Emits Callback settleILMark(positionId, ilBps, markValue)

7. settleILMark on hook updates Position.ilMarkBps + Position.markValue
   └─ Anyone can read the mark on-chain via getPosition(positionId)

8. exitPosition (LP, FEE-T or IL-T holder)
   └─ Hook removes liquidity → tokens credited to ilHolder.withdrawable
       (IL-T holder bears the IL outcome by receiving the position composition)
   └─ Emits PositionExited → RC activeCount--
```

---

## 4. Technical Implementation

### 4.1 Hook Permissions

| Permission | Enabled | Purpose |
|-----------|---------|---------|
| afterInitialize | Yes | Mark pool as initialized |
| beforeSwap | Yes | Return DYNAMIC_FEE override (30 bps base) |
| afterSwap | Yes | Emit SwapOccurred for the RC |
| All others | No | Not required |

The hook address was CREATE2 salt-mined to encode bits 12, 7, 6.

### 4.2 Position Struct

```solidity
struct Position {
    address lp;             // original depositor
    address feeHolder;      // owner of FEE-T (yield + premium)
    address ilHolder;       // owner of IL-T (bears price-driven outcome)
    PoolKey poolKey;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
    uint160 entrySqrtPriceX96;
    bool active;
    uint256 askPremium;     // premium IL-T buyer pays to FEE-T holder
    bool ilBondSold;        // whether IL-T has been transferred to a buyer
    int256 ilMarkBps;       // last-known IL mark in BPS (negative for ILHolder loss)
    uint256 markValue;      // last-known mark value (informational)
}
```

`feeHolder` and `ilHolder` are the two "tokens" — they are simple owner mappings inside the position struct, with `transferFeeToken` / `transferILToken` for transfers and `buyILBond` for the canonical premium-paying purchase. This mirrors a fungible-token API while staying in a single contract.

### 4.3 Reactive IL Computation (in ReactVM)

```solidity
function _computeILMark(PositionData memory p, uint160 currentSqrt)
    internal pure returns (int256 ilBps, uint256 markValue)
{
    if (p.entrySqrtPriceX96 == 0 || currentSqrt == 0 || p.liquidity == 0) return (0, 0);

    uint256 sqrtR = uint256(currentSqrt) * PRECISION / uint256(p.entrySqrtPriceX96);
    uint256 r     = sqrtR * sqrtR / PRECISION;
    uint256 num   = 2 * sqrtR * BPS;
    uint256 denom = PRECISION + r;
    uint256 ratio = num / denom;
    uint256 ilMagnitude = ratio >= BPS ? 0 : (BPS - ratio);

    ilBps     = -int256(ilMagnitude);
    markValue = uint256(p.liquidity) * (BPS - ilMagnitude) / BPS;
}
```

This is the standard Uniswap-V2 IL formula extended to V3/V4 (constant-product invariant). The result is posted back to the hook in basis points; the dashboard / external consumers can read `getPosition(id).ilMarkBps` for the current mark at any time.

### 4.4 Reactive Subscriptions

```solidity
// Constructor (Lasna):
service.subscribe(destChainId, hook, swapTopic);
service.subscribe(destChainId, hook, positionCreatedTopic);
service.subscribe(destChainId, hook, positionExitedTopic);
service.subscribe(destChainId, hook, ilBondDataBundleTopic);
```

**No cron.** This is a deliberate design choice. IL is fundamentally a function of price; price changes only on swaps; therefore the IL mark only ever needs to update on swaps. A cron tick fires regardless of price activity and would waste gas. ILBondReactive is *purely* event-driven.

---

## 5. Live Deployment & Validation (Fresh Run — 2026-05-27)

End-to-end run with **two independent wallets**, so the IL-bond sale is a genuine
bilateral trade rather than a self-deal:

| Wallet | Role | Address |
|--------|------|---------|
| W1 | LP / FEE-T holder | `0x49aBE186a9B24F73E34cCAe3D179299440c352aC` |
| W2 | IL-T buyer | `0xcD46C4C833725bC46b8aA4136BCdd35b615b5BC5` |

### 5.1 Deployed Contracts

| Contract | Network | Chain ID | Address | Deploy tx |
|----------|---------|----------|---------|-----------|
| ALPHA (token0) | Sepolia | 11155111 | `0x1E0a671C889e49fA2Ecf2F07E3930cd9B11E3591` | `0x11d59cea32243e572abf1ad0127f33e2f2390dc77121f15719b8a0bb2306b5a2` |
| BETA (token1) | Sepolia | 11155111 | `0x9a731FC6652C8cc101ABcB0717d808ab09397aB9` | `0x7f3ca7f67890fca544ed6b0c2ce8f3554e8c290533aa52a04308d1db204a9d46` |
| ILBondHook | Sepolia | 11155111 | `0x55f571E0DC76De9154DeA40B4749a6449CF510C0` | `0x3387273a8c3fa779ee339786f2ab121f42829615e16f3d7aad78b917bd9d22ce` |
| ILBondReactive | Lasna | 5318007 | `0xe560786b23fd0408E8f42a6799630294F87203d9` | `0x9e91708c5c53685366c4102b0270414398b4b10fd9cc82a918c34f7a0e172b64` |

### 5.2 End-to-End Flow Graph (every arrow is a real on-chain tx)

```
╔══════════════════════════ SEPOLIA · chain 11155111 ══════════════════════════╗
║                                                                              ║
║  [1] Deploy ILBondHook (CREATE2, mined for hook-flag bits)                   ║
║        tx 0x3387273a…bd9d22ce                                                ║
║                                                                              ║
║  [2] Deploy ALPHA + BETA · [3] init dynamic-fee pool @ 1:1 · [4] seed 100e18 ║
║        init  tx 0x99bac1eb…f6c90232      seed tx 0x22c68c0b…bd5b15a2          ║
║                                  │                                           ║
║  [5] W1 depositILBond ──────────►│  position 0: L=10e18, premium 0.1 BETA    ║
║        tx 0x29a6af7d…c22579952   │  FEE-T = W1, IL-T = W1                     ║
║                                  ▼                                           ║
║  [6] W2 buyILBond(0) ─ pays 0.1 BETA ─► credited to W1                       ║
║        approve tx 0x11cd9434…b72a5b44                                        ║
║        buy     tx 0xb06f25ec…4a74799c8a34                                    ║
║        RESULT: IL-T → W2, ilBondSold = true                                  ║
║                                  │                                           ║
║  [7] Fund hook 0.05 ETH + coverDebt()  ◄── CC must pre-pay callback gas      ║
║        fund  tx 0x7546d813…43b21df8     cover tx 0x49aa4984…ec6540fe         ║
║                                  │                                           ║
║  [8] W1 swaps  20→ / 10← / 15→   price 1:1 ──► tick −6237 (~46% drop)         ║
║        tx 0x3ae490ad…327ab03e / 0x138e2c09…2f8f6d39 / 0x16e8436d…1745c151     ║
║                                  │                                           ║
║        each swap emits  SwapOccurred ─────────────────────┐                  ║
╚═══════════════════════════════════════════════════════════│══════════════════╝
                                                             │
                          (Reactive Network monitors Sepolia)│
                                                             ▼
╔════════════════════════ REACTIVE LASNA · chain 5318007 ══════════════════════╗
║  [C] ILBondReactive deployed, subscribed to 4 hook topics, funded 2 REACT    ║
║                                                                              ║
║      react(SwapOccurred)       ─emit Callback─►  prepareILBondData(hook)      ║
║      react(ILBondDataBundle)   ─compute IL ─►    settleILMark(hook,…)         ║
║          IL = 1 − 2√r/(1+r)  computed inside the ReactVM                      ║
╚═══════════════════════════════════│══════════════════════════════════════════╝
                                     │ callbacks delivered back to Sepolia
                                     ▼
╔══════════════════════════ SEPOLIA · chain 11155111 ══════════════════════════╗
║  [9]  prepareILBondData ──► hook emits ILBondDataBundle  (bundleCounter++)    ║
║        tx 0x60dad23f…e0f9e312 / 0x1647a92f…e03b5ffe… / 0xc0c35d1c…49b7a3a…    ║
║                                  │                                           ║
║  [10] settleILMark ──► hook writes Position.ilMarkBps + emits ILMarkUpdated  ║
║        tx 0x622c9e1a…0ce87ba5… / 0x6809a870…71be9cb4… / 0x7473891b…85697b574a ║
║                                  ▼                                           ║
║  RESULT (position 0):  ilMarkBps = −468  (−4.68% IL)                          ║
║                        markValue = 9.532e18   ·   bundleCounter = 4           ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 5.3 Full Transaction Reference (Sepolia unless noted)

**Setup & position (W1)**
| Step | Action | Tx hash |
|------|--------|---------|
| 1 | Deploy ILBondHook (CREATE2) | `0x3387273a8c3fa779ee339786f2ab121f42829615e16f3d7aad78b917bd9d22ce` |
| 2a | Deploy ALPHA | `0x11d59cea32243e572abf1ad0127f33e2f2390dc77121f15719b8a0bb2306b5a2` |
| 2b | Deploy BETA | `0x7f3ca7f67890fca544ed6b0c2ce8f3554e8c290533aa52a04308d1db204a9d46` |
| 3 | Initialize pool | `0x99bac1eb96b1c31e6d183762706cf359a27cb032edc9776b1ff02dbaf6c90232` |
| 4 | Seed base liquidity | `0x22c68c0b6d7661bd324d54552e7cb54d4f3e636454a64c891d992e5dbd5b15a2` |
| 5 | depositILBond → position 0 | `0x29a6af7d35449a8d22deacaf121a540345a9dd326e184f30aedf033c22579952` |

> Plus token mints + 10 approvals (Permit2 / hook / router) in the same Wallet1 broadcast
> (`broadcast/20_ILBondFlow.s.sol/11155111/run-latest.json`).

**IL-T sale (W2)**
| Step | Action | Tx hash |
|------|--------|---------|
| 6a | W2 approve BETA → hook | `0x11cd9434d26adbbb988d966411c85031c57e9ba1f600844f05ec488bb72a5b44` |
| 6b | W2 buyILBond(0) | `0xb06f25ecaf9d82b65688534d92885ffea5351d48c95840922cf74a74799c8a34` |

**Reactive contract (W1, Lasna)**
| Step | Action | Tx hash |
|------|--------|---------|
| C | Deploy ILBondReactive (+2 REACT) | `0x9e91708c5c53685366c4102b0270414398b4b10fd9cc82a918c34f7a0e172b64` |

**Callback funding + price-moving swaps (W1)**
| Step | Action | Tx hash |
|------|--------|---------|
| 7a | Fund hook 0.05 ETH | `0x7546d813405730982f62058cf26d8b26d45dbf49dd18b3aa5f7459eb43b21df8` |
| 7b | coverDebt() | `0x49aa4984c411a93450669e2198af89f46caefc8fead1ead0e594c83eec6540fe` |
| 8a | swap 20e18 zeroForOne | `0x3ae490ad2565a5a37b29a1d495b21188869146cd5debf24afd7393d0327ab03e` |
| 8b | swap 10e18 oneForZero | `0x138e2c0991eb493bf7b7ce4c7b3ef49b34fbd6bb635b5372b86e225b2f8f6d39` |
| 8c | swap 15e18 zeroForOne | `0x16e8436d518cc9b98b92587f513220037b0cb7968ef72ee44dd9d8141745c151` |

**RC → hook callbacks (sender = Sepolia callback proxy `0xc9f3…7bDA`)**
| Step | Callback | Tx hash |
|------|----------|---------|
| 9 | prepareILBondData → ILBondDataBundle | `0x60dad23fae1d164859d73c6a5766a67c15b07296d312a21b317746b8e0f9e312` |
| 9 | prepareILBondData → ILBondDataBundle | `0x1647a92fbe7226afdcd41d8288e9df9fb322dd11364a469e03b5ffe3c06adbfd` |
| 9 | prepareILBondData → ILBondDataBundle | `0xc0c35d1c6bf0c8e47f7e8d1fd816830d8d541febd90b15ed249b7a3a1611d11d` |
| 10 | settleILMark → ILMarkUpdated | `0x622c9e1ab936b81610432a4484c7bd7a30fafb36bef47772560ce87ba5c186dd` |
| 10 | settleILMark → ILMarkUpdated | `0x6809a8706fcb85a80b68703c9415e600879da36bf840e35a071be9cb46f094a8` |
| 10 | settleILMark → ILMarkUpdated | `0x7473891bb310c3a0f71637845d14e0fc7b7591929f017eb57a7d0785697b574a` |

### 5.4 On-Chain Results

**Hook (Sepolia), read via `getPosition(0)`:**
```
lp / feeHolder:  0x49aBE186…  (W1)
ilHolder:        0xcD46C4C8…  (W2)        ← IL-T sold to the second wallet
active:          true,  ilBondSold: true
liquidity:       10e18
entrySqrtPriceX96: 79228162514264337593543950336 (1:1)
askPremium:      0.1 BETA
ilMarkBps:       -468            ← RC-posted mark: -4.68% IL
markValue:       9.532e18
bundleCounter:   4
```

**W1 withdrawable (Sepolia):** `amount1 = 0.1 BETA` — the premium, paid by W2.

**Reactive Contract (Lasna):** balance `1.957 REACT` (deployed with 2.0; ~0.043 spent
across prepare + settle callbacks), `activeCount = 0` (position 0 predates the RC, so it
was never counted — yet the hook still marks it because it iterates its *own* active set).

### 5.5 Operational Note — the Callback Contract Must Be Funded

The hook is an `AbstractPayer`: every callback it receives is billed by the Sepolia
callback proxy. On the first run the hook had **0 ETH**, so it went into debt after the
very first `prepareILBondData` callback and the proxy stopped delivering anything further
— `bundleCounter` froze at 1 and no IL mark ever settled. Sending 0.05 ETH to the hook and
calling `coverDebt()` (steps 7a/7b) cleared the debt; the next swaps then completed the
full prepare → bundle → settle loop. **A reactive CC needs gas money on the destination
chain, exactly like the RC needs REACT on Lasna.**

### 5.6 Premium Settlement Flow Validated

```
Before buyILBond (W2):                 After buyILBond (W2):
  W1 withdrawable[BETA] = 0             W1 withdrawable[BETA] = 0.1 BETA
  ilHolder = W1                          ilHolder = W2
  ilBondSold = false                     ilBondSold = true
```

The 0.1 BETA premium moved from buyer (W2) → FEE-T holder (W1) atomically. No pool, no
insurance fund — just a bilateral premium for transferring the IL leg.

---

## 6. Why Reactive Network is Architecturally Essential

| Capability | V4 Hook | Keepers | Reactive Network |
|-----------|---------|---------|-----------------|
| Update IL mark on every price change | Only during swaps; expensive | Periodic, dumb | **Yes — exact, swap-driven** |
| Compute IL math against entry price | Prohibitive on L1 | Can't compute | **Yes — cheap in ReactVM** |
| Make decisions based on computation | No | No (just trigger) | **Yes — react() can decide** |
| React without keeper polling | Limited | Manual | **Yes — native** |
| Two-phase data relay | Impossible | Impossible | **Native pattern** |

The hook can *only* update IL during swaps — and even there, doing IL math in the swap path would be expensive and would slow every swap. Pushing the math to the RSC keeps the swap path cheap (just emit a price snapshot) and keeps the IL accounting precise and externally auditable.

---

## 7. Why This Pattern Is New

The closest precedent in V4 is the Fixed/Leverage Yield Hook (UHI3), which split LP returns into "guaranteed" and "leveraged" classes. But that hook splits **returns** — the upside. ILBondHook splits **risk** — the downside exposure to price movement.

It's the difference between tranching the senior/junior cashflows of a bond (UHI3 / fixed-yield hook) and **separating the bond from its credit-default swap** (ILBondHook). The latter creates a real two-sided market for the risk itself — something that doesn't exist in DeFi today.

---

## 8. Repository Structure

```
v4-template/
├── src/
│   ├── ILBondHook.sol            # V4 Hook + Reactive Callback Contract
│   ├── ILBondReactive.sol        # Reactive Contract (deployed on Lasna)
│   └── MockERC20.sol
├── script/
│   ├── 11_DeployILBondHook.s.sol      # CREATE2 salt-mined hook deployment
│   ├── 13_ILBondSeedAndDeposit.s.sol  # single-wallet seed + deposit + buy + swaps
│   ├── 20_ILBondFlow.s.sol            # full Sepolia setup: hook+tokens+pool+seed+position 0
│   └── 21_ILBondSwaps.s.sol           # price-moving swaps that drive the RC pipeline
├── ILBOND_PITCH.md               # 1-page pitch with visuals
├── ILBOND_REPORT.md              # This report
└── foundry.toml                  # via_ir=true, optimizer=200 runs
```

---

## 9. Conclusion

ILBondHook is the first Uniswap V4 hook to *unbundle* a concentrated LP position into independent yield (FEE-T) and risk (IL-T) legs, with continuous mark-to-market handled autonomously by a Reactive Smart Contract on Lasna. The pattern is genuinely new: every other IL-related hook reduces, hedges, or insures IL — none of them separate it.

**Validated end-to-end:**
- Real V4 liquidity created on Sepolia.
- FEE-T + IL-T minted from a single LP deposit.
- Real IL-T sale transferred 0.1 BETA premium from buyer to FEE-T holder.
- Three swaps drove price down 31% (real IL territory).
- RC subscribed event-only (no cron), reacted to swaps, and ran the prepare → bundle → settleILMark pipeline.

IL stops being a uniform tax on LP capital. It becomes a tradable asset class with its own market, priced bilaterally between yield seekers and vol takers.

---

*Built for UHI9 (Uniswap Hooks Incubator 9) — Theme: Impermanent Loss*
*Powered by Uniswap V4 + Reactive Network*
