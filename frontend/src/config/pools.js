import { keccak256, encodeAbiParameters } from 'viem'
import { ADDR, DYNAMIC_FEE_FLAG, TICK_SPACING } from './contracts'

// ─────────────────────────────────────────────────────────────────────────────
//  TOKEN REGISTRY  (v2 multi-pool deployment, 2026-06-07)
//  Keyed by lowercased address. `mintable` = our MockERC20 with public mint()
//  → can power an in-app faucet. Real Aave Sepolia tokens are not mintable here.
// ─────────────────────────────────────────────────────────────────────────────

const RAW_TOKENS = [
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

export const TOKENS = Object.fromEntries(RAW_TOKENS.map((t) => [t.address.toLowerCase(), t]))

const UNKNOWN = { symbol: '???', name: 'Unknown token', decimals: 18, mintable: false }

/** Look up token metadata by address (case-insensitive). Always returns an object. */
export function getToken(address) {
  if (!address) return { ...UNKNOWN, address }
  return TOKENS[address.toLowerCase()] || { ...UNKNOWN, address }
}

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
export function buildPoolKey(tokenA, tokenB) {
  const [c0, c1] =
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]
  return {
    currency0: c0,
    currency1: c1,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: ADDR.hook,
  }
}

export function poolIdFromKey(key) {
  return keccak256(encodeAbiParameters(POOL_KEY_TUPLE, [key]))
}

// ─────────────────────────────────────────────────────────────────────────────
//  POOL REGISTRY  — every C(10,2)=45 token-pair combination, matching the
//  on-chain FreshDeploy script (same token order). One pair is the `demo` pool
//  (in-app faucet). Pairs are sorted to canonical currency0/1 by buildPoolKey.
// ─────────────────────────────────────────────────────────────────────────────

// The designated demo pair (both tokens mintable) — exposes the faucet.
const DEMO_PAIR = ['WETH', 'WBTC']
const isDemoPair = (s0, s1) =>
  (s0 === DEMO_PAIR[0] && s1 === DEMO_PAIR[1]) || (s0 === DEMO_PAIR[1] && s1 === DEMO_PAIR[0])

export const POOLS = (() => {
  const list = []
  for (let i = 0; i < RAW_TOKENS.length; i++) {
    for (let j = i + 1; j < RAW_TOKENS.length; j++) {
      const key = buildPoolKey(RAW_TOKENS[i].address, RAW_TOKENS[j].address)
      const id = poolIdFromKey(key)
      const t0 = getToken(key.currency0)
      const t1 = getToken(key.currency1)
      list.push({
        id,
        key,
        token0: key.currency0,
        token1: key.currency1,
        sym0: t0.symbol,
        sym1: t1.symbol,
        dec0: t0.decimals,
        dec1: t1.decimals,
        label: `${t0.symbol}/${t1.symbol}`,
        demo: isDemoPair(RAW_TOKENS[i].symbol, RAW_TOKENS[j].symbol),
      })
    }
  }
  return list
})()

export const POOLS_BY_ID = Object.fromEntries(POOLS.map((p) => [p.id.toLowerCase(), p]))

export const DEMO_POOL = POOLS.find((p) => p.demo) || POOLS[0]

export function getPoolById(id) {
  return id ? POOLS_BY_ID[id.toLowerCase()] : undefined
}
