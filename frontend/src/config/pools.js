import { keccak256, encodeAbiParameters } from 'viem'
import { ADDR, DYNAMIC_FEE_FLAG, TICK_SPACING } from './contracts'

// ─────────────────────────────────────────────────────────────────────────────
//  TOKEN REGISTRY — the Sepolia (original) deployment's 10 tokens.
//  Other chains supply their own token list via config/networks.js. Keyed by
//  lowercased address. `mintable` = our MockERC20 with public mint() → faucet.
// ─────────────────────────────────────────────────────────────────────────────

export const SEPOLIA_RAW_TOKENS = [
  // custom (mintable)
  { address: '0x748b5C9623528D346C414F4f236B3b5b5c7683cb', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, mintable: true },
  { address: '0x912A7Fb66391eAe95DDee40B664FF497108580CD', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, mintable: true },
  { address: '0x160fC2D6a542565ba7C2a57E18d6b28F62C8D0C7', symbol: 'LINK', name: 'Chainlink', decimals: 18, mintable: true },
  { address: '0xCbAcA08f7eB9eB07537F344EbeC7E79302F60823', symbol: 'UNI', name: 'Uniswap', decimals: 18, mintable: true },
  { address: '0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba', symbol: 'AAVE', name: 'Aave Token', decimals: 18, mintable: true },
  { address: '0x00A311cd8BE35953635b0Bc619bdC807782dfC5E', symbol: 'GHO', name: 'GHO Stablecoin', decimals: 18, mintable: true },
  // real Sepolia tokens (deployer-held, not mintable in-app)
  { address: '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, mintable: false },
  { address: '0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E', symbol: 'EURS', name: 'STASIS EURS', decimals: 2, mintable: false },
  { address: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', symbol: 'USDC', name: 'USD Coin', decimals: 6, mintable: false },
  { address: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0', symbol: 'USDT', name: 'Tether USD', decimals: 6, mintable: false },
]

const UNKNOWN = { symbol: '???', name: 'Unknown token', decimals: 18, mintable: false }

// ─────────────────────────────────────────────────────────────────────────────
//  POOL KEY / ID
// ─────────────────────────────────────────────────────────────────────────────

const POOL_KEY_TUPLE = [
  {
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
]

/** Build the canonical PoolKey for a token pair (currency0 < currency1 by address). */
export function buildPoolKey(tokenA, tokenB, hook = ADDR.hook) {
  const [c0, c1] =
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]
  return {
    currency0: c0,
    currency1: c1,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: hook,
  }
}

export function poolIdFromKey(key) {
  return keccak256(encodeAbiParameters(POOL_KEY_TUPLE, [key]))
}

// ─────────────────────────────────────────────────────────────────────────────
//  REGISTRY BUILDER — given a chain's token list + hook, produce every
//  C(n,2) pair pool (matching the on-chain deploy script's token order) plus
//  lookups. Used per-network by config/networks.js.
// ─────────────────────────────────────────────────────────────────────────────

export function buildPoolRegistry({ rawTokens, hook = ADDR.hook, demoPair }) {
  const tokens = Object.fromEntries(rawTokens.map((t) => [t.address.toLowerCase(), t]))
  const getToken = (address) => {
    if (!address) return { ...UNKNOWN, address }
    return tokens[address.toLowerCase()] || { ...UNKNOWN, address }
  }
  const isDemoPair = (s0, s1) =>
    !!demoPair &&
    ((s0 === demoPair[0] && s1 === demoPair[1]) || (s0 === demoPair[1] && s1 === demoPair[0]))

  const pools = []
  for (let i = 0; i < rawTokens.length; i++) {
    for (let j = i + 1; j < rawTokens.length; j++) {
      const key = buildPoolKey(rawTokens[i].address, rawTokens[j].address, hook)
      const id = poolIdFromKey(key)
      const t0 = getToken(key.currency0)
      const t1 = getToken(key.currency1)
      pools.push({
        id,
        key,
        token0: key.currency0,
        token1: key.currency1,
        sym0: t0.symbol,
        sym1: t1.symbol,
        dec0: t0.decimals,
        dec1: t1.decimals,
        label: `${t0.symbol}/${t1.symbol}`,
        demo: isDemoPair(rawTokens[i].symbol, rawTokens[j].symbol),
      })
    }
  }
  const poolsById = Object.fromEntries(pools.map((p) => [p.id.toLowerCase(), p]))
  const demoPool = pools.find((p) => p.demo) || pools[0]
  const getPoolById = (id) => (id ? poolsById[id.toLowerCase()] : undefined)

  return { tokens, getToken, pools, poolsById, demoPool, getPoolById }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sepolia defaults (legacy/back-compat: the OG edge function + any module that
//  imports a fixed registry). Chain-aware UI code should use useNetwork() instead.
// ─────────────────────────────────────────────────────────────────────────────

const sepoliaRegistry = buildPoolRegistry({
  rawTokens: SEPOLIA_RAW_TOKENS,
  hook: ADDR.hook,
  demoPair: ['WETH', 'WBTC'],
})

export const TOKENS = sepoliaRegistry.tokens
export const getToken = sepoliaRegistry.getToken
export const POOLS = sepoliaRegistry.pools
export const POOLS_BY_ID = sepoliaRegistry.poolsById
export const DEMO_POOL = sepoliaRegistry.demoPool
export const getPoolById = sepoliaRegistry.getPoolById
