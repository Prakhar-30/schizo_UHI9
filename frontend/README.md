# schizō frontend

A platform for the **ILBondHook**: hedge a Uniswap v4 LP position by splitting it into a **yield leg (FEE-T)**
and a **risk leg (IL-T)**, with impermanent loss marked to market **inside the hook itself** on every swap.
No oracle, no keeper, no second network.

Live on **Ethereum Sepolia** and **Unichain Sepolia** (independent hook deployments).

## Stack

- **Vite** + **React 19** (JavaScript) + **Tailwind CSS** (brutalist × glassmorphism design system)
- **wagmi** + **viem** + **RainbowKit** + **@tanstack/react-query**
- All hook data is read straight from chain, no backend required. (Supabase can be layered on later
  for indexing/social features.)

## Pages

| Route               | What it does |
|---------------------|--------------|
| `/`                 | Landing: the pitch, the split, how it flows |
| `/pools`            | Every dynamic-fee pool: live price, trend, fee, liquidity |
| `/create`           | Hedging desk: faucet, configure & mint a bond (FEE-T + IL-T) |
| `/hunt`             | Underwriting desk: every open position whose risk leg still needs a counterparty |
| `/markets`          | Live order book: every position + IL mark, faucet, live activity feed |
| `/positions/:id`    | Deep view: stats + IL/price history chart + outcome calculator + activity + share card |
| `/dashboard`        | Your bonds, your legs, claimable balances |
| `/about`            | Concept, architecture, step-by-step guide, deployed contracts |

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Configuration (`.env`)

```bash
# WalletConnect / Reown project id, only needed for WalletConnect QR.
# MetaMask / injected wallets work without it. Get one at https://cloud.reown.com
VITE_WALLETCONNECT_PROJECT_ID=

# Optional RPC overrides (public defaults are used if blank)
VITE_SEPOLIA_RPC=
VITE_UNICHAIN_RPC=
```

A dedicated Sepolia RPC (Alchemy/Infura) is recommended; the Markets/Dashboard pages read event
logs, which public RPCs sometimes rate-limit.

## Share cards (OG images)

Position pages (`/positions/:id`) generate per-position [Open Graph](https://ogp.me) cards so X /
Telegram / Discord / iMessage unfurl them automatically.

- **Image renderer**: `api/og.js` (Vercel Edge Function, `@vercel/og`, plain JS + `React.createElement`
  so Vercel's TS check doesn't run on it). Reads the position straight from Sepolia and renders a
  1200×630 PNG.
- **Meta injection**: `api/position-page.js` (Edge Function) fetches `/index.html`, injects `og:*`
  and `twitter:*` tags for the requested position, and returns the rewritten HTML. Crawlers don't run
  JS, so client-side meta updates wouldn't work, and Vercel's edge *middleware* is unreliable for
  non-Next.js projects, so a rewrite + function is the bulletproof path.
- **Routing**: `vercel.json` rewrites `/positions/:id(\d+)` → `/api/position-page?id=:id` and
  everything else (except `/api/*`) → `/index.html`.

To test locally with edge functions:

```bash
npm i -g vercel
vercel dev    # http://localhost:3000, runs middleware + /api/og
```

`npm run dev` alone is fine for everything except the OG card (the `/api/og` URL 404s; the SharePanel
falls back to a placeholder).

Optional env var on Vercel:

```
SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/<key>
```

Falls back to a public RPC if unset.

## Where the chain wiring lives

- `src/config/contracts.js`: addresses, ABIs (human-readable), pool constants
- `src/config/networks.js`: per-chain registry (hook, tokens, pools, explorer)
- `src/config/chains.js`, `src/config/wagmi.js`: Sepolia + Unichain Sepolia, RainbowKit config
- `src/hooks/reads.js`: all on-chain reads (positions, price, live marks, activity, balances)
- `src/hooks/useTx.js`: write → wait-for-receipt → toast lifecycle

> Testnet only. Not financial advice. Built for UHI9, theme: Impermanent Loss.
