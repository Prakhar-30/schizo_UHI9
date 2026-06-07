import { ImageResponse } from '@vercel/og'
import { createElement as h } from 'react'
import { createPublicClient, http, parseAbi, parseAbiItem } from 'viem'
import { sepolia } from 'viem/chains'

export const config = { runtime: 'edge' }

// v2 multi-pool deployment.
const HOOK = '0x9D19eA2aad6c8748d566f28fe375fb8BCAA350c0'
const POOL_MANAGER = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'
const STATE_VIEW = '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c'
const DEPLOY_BLOCK = 11006000n
const RPC = process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'

// poolId → { label, premium token symbol + decimals } for the 10 seeded pools.
const POOLS = {
  '0x71540b47ef5680786153b43d49b46d3c23ca3ffb2c0b28cb875c078e8a3c600b': { label: 'WETH/USDC', sym1: 'USDC', dec1: 6 },
  '0x5433b114a0cc035f0fd6f61ef7d7987314ce541ffa9e1c98fa894acfe48699d8': { label: 'WBTC/USDT', sym1: 'USDT', dec1: 6 },
  '0x8d4683196016e93e0da736d43e97663e200f79de5e4f6aeb2275988e3a0e4e6b': { label: 'WETH/DAI', sym1: 'DAI', dec1: 18 },
  '0xe859c020fc36c365a3cd6b38e445643130d2f13ab918c47e7f3e53b3548f4bce': { label: 'LINK/WETH', sym1: 'WETH', dec1: 18 },
  '0xb47bf1c3c9864c2612575cc391e7b5d32788b1d3eb2af76d749a47283778132a': { label: 'WETH/UNI', sym1: 'UNI', dec1: 18 },
  '0xaf9490a86d6c9f4905022fa944900b432ad7290237290cc575c470512b56077f': { label: 'AAVE/WETH', sym1: 'WETH', dec1: 18 },
  '0x17f5bbc7d37f4b0144799cea8e60ba9a5584629458c99d769d684ae6602e8f2b': { label: 'GHO/DAI', sym1: 'DAI', dec1: 18 },
  '0x2691074cfcc71be8f17cb9d5c44833460a90adbfda2bbc72d6dbb0474cccacb2': { label: 'WETH/WBTC', sym1: 'WBTC', dec1: 8 },
  '0xe2d7dc6ec7bb3180e337df2d090fbdeb4b8e05d4af68d7b27f8a481ef5b36390': { label: 'EURS/WETH', sym1: 'WETH', dec1: 18 },
  '0xc7b544701fdc8ee307c375c75f2716862296fc0ce19c82ea235a82fdcc96ca54': { label: 'USDC/DAI', sym1: 'DAI', dec1: 18 },
}

const HOOK_ABI = parseAbi([
  'function getPosition(uint256 positionId) view returns (address lp, address feeHolder, address ilHolder, bool active, bool ilBondSold, uint128 liquidity, uint160 entrySqrtPriceX96, int256 ilMarkBps, uint256 markValue, uint256 askPremium)',
])
const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
])
const MODIFY_LIQ_EVENT = parseAbiItem(
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
)

const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

// Recover a position's poolId from the PoolManager ModifyLiquidity log
// (the hook mints with salt = bytes32(positionId)).
async function poolIdForPosition(id) {
  try {
    const head = await client.getBlockNumber()
    const logs = await client.getLogs({
      address: POOL_MANAGER,
      event: MODIFY_LIQ_EVENT,
      args: { sender: HOOK },
      fromBlock: DEPLOY_BLOCK,
      toBlock: head,
    })
    for (const l of logs) {
      if (Number(BigInt(l.args.salt)) === Number(id)) return String(l.args.id).toLowerCase()
    }
  } catch (_e) {
    /* ignore */
  }
  return null
}

// IL = 1 − 2√r/(1+r), r = (current/entry)²; returns signed bps (negative = loss).
function liveIlBps(entrySqrt, curSqrt) {
  if (!entrySqrt || !curSqrt) return null
  const r = (Number(curSqrt) / Number(entrySqrt)) ** 2
  if (!isFinite(r) || r <= 0) return null
  const il = 1 - (2 * Math.sqrt(r)) / (1 + r)
  return -Math.round(il * 10000)
}

function fmtAmount(v, decimals) {
  const n = Number(v) / 10 ** decimals
  if (!isFinite(n)) return '—'
  if (n !== 0 && Math.abs(n) < 0.0001) return '<0.0001'
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function fmtCompact(v) {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  const abs = Math.abs(n)
  const u = [
    [1e24, 'Y'], [1e21, 'Z'], [1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K'],
  ]
  for (const [v2, s] of u) if (abs >= v2) return (n / v2).toFixed(2).replace(/\.?0+$/, '') + s
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

const C = {
  ink: '#08080a',
  card: '#121218',
  line: '#26262f',
  bone: '#f3efe4',
  mute: '#6a6a78',
  volt: '#7c5cff',
  yield: '#c6ff2e',
  risk: '#ff2e6d',
  amber: '#ffb020',
  mint: '#2ef8d8',
}

function fmtBpsPct(bps) {
  const n = Number(bps) / 100
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%'
}

// Every Satori container needs an explicit display value — there is no implicit
// block layout. Helper sets display:flex so individual call sites can override.
const box = (style, ...kids) => h('div', { style: { display: 'flex', ...style } }, ...kids)

function Stat(label, value, color) {
  return box(
    { flexDirection: 'column', flex: 1, gap: 8, minWidth: 0 },
    box(
      { fontSize: 16, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.32em', fontWeight: 700 },
      label,
    ),
    box({ fontSize: 44, fontWeight: 800, color, letterSpacing: -1 }, value),
  )
}

export default async function handler(req) {
  const url = new URL(req.url)
  const id = (url.searchParams.get('id') || '0').replace(/[^0-9]/g, '') || '0'

  let pos = null
  try {
    const r = await client.readContract({
      address: HOOK,
      abi: HOOK_ABI,
      functionName: 'getPosition',
      args: [BigInt(id)],
    })
    if (r[0] !== '0x0000000000000000000000000000000000000000') {
      pos = {
        active: r[3],
        ilBondSold: r[4],
        liquidity: r[5],
        entrySqrt: r[6],
        ilMarkBps: r[7],
        askPremium: r[9],
      }
    }
  } catch (_e) {
    pos = null
  }

  // Resolve the position's pool → correct premium token/decimals + live IL.
  let pool = null
  let ilNum = pos ? Number(pos.ilMarkBps) : 0
  if (pos) {
    const poolId = await poolIdForPosition(id)
    pool = poolId ? POOLS[poolId] : null
    if (poolId) {
      try {
        const slot0 = await client.readContract({
          address: STATE_VIEW,
          abi: STATE_VIEW_ABI,
          functionName: 'getSlot0',
          args: [poolId],
        })
        const live = liveIlBps(pos.entrySqrt, slot0[0])
        if (live !== null) ilNum = live
      } catch (_e) {
        /* fall back to on-chain mark */
      }
    }
  }

  const dec1 = pool?.dec1 ?? 18
  const sym1 = pool?.sym1 || ''
  const premiumStr = pos ? `${fmtAmount(pos.askPremium, dec1)}${sym1 ? ' ' + sym1 : ''}` : '—'
  const subtitle = pool ? `IL Bond Position · ${pool.label}` : 'IL Bond Position'

  const ilColor = !pos ? C.mute : ilNum <= -400 ? C.risk : ilNum <= -100 ? C.amber : C.yield
  const statusColor = !pos ? C.mute : pos.ilBondSold ? C.risk : C.amber
  const statusLabel = !pos ? 'NOT FOUND' : pos.ilBondSold ? 'IL-T SOLD' : 'IL-T OPEN'

  return new ImageResponse(
    box(
      {
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: C.ink,
        color: C.bone,
        padding: 56,
        fontFamily: 'sans-serif',
        position: 'relative',
        justifyContent: 'space-between', // top group hugs top, footer hugs bottom
      },

      // ── background atmosphere ───────────────────────────────────────────
      box({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage:
          'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        opacity: 0.5,
      }),
      box({
        position: 'absolute',
        right: -120,
        bottom: -160,
        width: 520,
        height: 520,
        background: 'radial-gradient(circle at center, ' + ilColor + '33, transparent 70%)',
      }),

      // ── top group ───────────────────────────────────────────────────────
      box(
        { flexDirection: 'column', gap: 36 },

        // top bar
        box(
          { alignItems: 'center', gap: 18 },
          box({
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'linear-gradient(135deg,' + C.volt + ',' + C.risk + ')',
            boxShadow: '4px 4px 0 0 #000',
          }),
          box({ fontSize: 40, fontWeight: 900, letterSpacing: -1 }, 'schizō'),
          box(
            {
              marginLeft: 'auto',
              alignItems: 'center',
              gap: 10,
              padding: '8px 14px',
              border: '2px solid ' + C.volt + '66',
              color: C.volt,
              borderRadius: 8,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
            },
            box({ width: 8, height: 8, background: C.volt, borderRadius: '50%' }),
            box({}, 'Reactive Network'),
          ),
        ),

        // id + chip
        box(
          { flexDirection: 'column' },
          box(
            { fontSize: 20, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.32em', fontWeight: 700 },
            subtitle,
          ),
          box(
            { alignItems: 'center', gap: 24, marginTop: 4 },
            box({ fontSize: 140, fontWeight: 900, lineHeight: 0.95, letterSpacing: -5 }, '#' + id),
            box(
              {
                padding: '10px 18px',
                border: '2px solid ' + statusColor,
                color: statusColor,
                borderRadius: 10,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '0.18em',
                marginBottom: 6,
              },
              statusLabel,
            ),
          ),
        ),

        // stats grid
        box(
          {
            gap: 20,
            border: '2px solid ' + C.line,
            borderRadius: 16,
            background: C.card,
            padding: 24,
          },
          Stat('Premium', premiumStr, C.yield),
          box({ width: 2, background: C.line }),
          Stat('IL Mark', pos ? fmtBpsPct(ilNum) : '—', ilColor),
          box({ width: 2, background: C.line }),
          Stat('Liquidity', pos ? fmtCompact(pos.liquidity) : '—', C.bone),
        ),
      ),

      // ── footer (hugs bottom via justifyContent on parent) ───────────────
      box(
        { alignItems: 'center', justifyContent: 'space-between' },
        box(
          { fontSize: 20, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.28em', fontWeight: 700 },
          'LP fees · without the impermanent loss',
        ),
        box(
          { gap: 10, alignItems: 'center' },
          box({ width: 10, height: 10, background: C.mint, borderRadius: '50%' }),
          box(
            { fontSize: 18, color: C.mute, letterSpacing: '0.2em', textTransform: 'uppercase' },
            'Sepolia · marked by RSC',
          ),
        ),
      ),
    ),
    { width: 1200, height: 630 },
  )
}
