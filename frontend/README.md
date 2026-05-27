# schizō — frontend

A platform for the **ILBondHook**: unbundle a Uniswap v4 LP position into a **yield leg (FEE-T)**
and a **risk leg (IL-T)**, with impermanent loss marked to market on every swap by the
**Reactive Network**.

Live on **Ethereum Sepolia** (hook + pool) and **Reactive Lasna** (the IL mark-to-market RSC).

## Stack

- **Vite** + **React 19** (JavaScript) + **Tailwind CSS** (brutalist × glassmorphism design system)
- **wagmi** + **viem** + **RainbowKit** + **@tanstack/react-query**
- All hook data is read straight from chain — no backend required. (Supabase can be layered on later
  for indexing/social features.)

## Pages

| Route        | What it does |
|--------------|--------------|
| `/`          | Landing — the pitch, the split, how it flows |
| `/create`    | Creator console — faucet, configure & mint a bond (FEE-T + IL-T) |
| `/markets`   | Live order book — every position + IL mark, a swap panel to drive the RSC, activity feed |
| `/dashboard` | Your bonds, your legs, claimable balances |
| `/about`     | Concept, architecture, step-by-step guide, deployed contracts |

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Configuration (`.env`)

```bash
# WalletConnect / Reown project id — only needed for WalletConnect QR.
# MetaMask / injected wallets work without it. Get one at https://cloud.reown.com
VITE_WALLETCONNECT_PROJECT_ID=

# Optional RPC overrides (public defaults are used if blank)
VITE_SEPOLIA_RPC=
VITE_LASNA_RPC=https://lasna-rpc.rnk.dev/
```

A dedicated Sepolia RPC (Alchemy/Infura) is recommended — the Markets/Dashboard pages read event
logs, which public RPCs sometimes rate-limit.

## Where the chain wiring lives

- `src/config/contracts.js` — addresses, ABIs (human-readable), pool constants
- `src/config/poolKey.js` — the pool key + derived `poolId`
- `src/config/chains.js`, `src/config/wagmi.js` — Sepolia + Lasna, RainbowKit config
- `src/hooks/reads.js` — all on-chain reads (positions, price, activity, balances, RSC status)
- `src/hooks/useTx.js` — write → wait-for-receipt → toast lifecycle

> Testnet only. Not financial advice. Built for UHI9 — theme: Impermanent Loss.
