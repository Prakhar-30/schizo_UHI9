import { ImageResponse } from '@vercel/og'
import { createElement as h } from 'react'
import { createPublicClient, http, parseAbi } from 'viem'
import { sepolia } from 'viem/chains'

export const config = { runtime: 'edge' }

// Kept in sync with frontend/src/config/contracts.js — duplicated here so the
// edge bundle has zero coupling to the Vite src tree.
const HOOK = '0x55f571E0DC76De9154DeA40B4749a6449CF510C0'
const RPC = process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'

const HOOK_ABI = parseAbi([
  'function getPosition(uint256 positionId) view returns (address lp, address feeHolder, address ilHolder, bool active, bool ilBondSold, uint128 liquidity, uint160 entrySqrtPriceX96, int256 ilMarkBps, uint256 markValue, uint256 askPremium)',
])

const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

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

function fmtBeta(v) {
  const n = Number(v) / 1e18
  if (!isFinite(n)) return '—'
  if (n !== 0 && Math.abs(n) < 0.0001) return '<0.0001'
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function fmtBpsPct(bps) {
  const n = Number(bps) / 100
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%'
}

// All Satori containers need display:flex — there is no implicit block layout.
// Helper sets that default so individual call sites can override.
const box = (style, ...kids) => h('div', { style: { display: 'flex', ...style } }, ...kids)

function Stat(label, value, color) {
  return box(
    { flexDirection: 'column', flex: 1, gap: 6, minWidth: 0 },
    box({ fontSize: 16, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.32em', fontWeight: 700 }, label),
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
        ilMarkBps: r[7],
        askPremium: r[9],
      }
    }
  } catch (_e) {
    pos = null
  }

  const ilNum = pos ? Number(pos.ilMarkBps) : 0
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
        padding: 64,
        fontFamily: 'sans-serif',
        position: 'relative',
      },

      // faint grid background
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

      // colored glow
      box({
        position: 'absolute',
        right: -120,
        bottom: -160,
        width: 520,
        height: 520,
        background: 'radial-gradient(circle at center, ' + ilColor + '33, transparent 70%)',
      }),

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
        { flexDirection: 'column', marginTop: 32 },
        box(
          { fontSize: 20, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.32em', fontWeight: 700 },
          'IL Bond Position',
        ),
        box(
          { alignItems: 'center', gap: 24, marginTop: 4 },
          box({ fontSize: 150, fontWeight: 900, lineHeight: 0.95, letterSpacing: -5 }, '#' + id),
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
          marginTop: 28,
          border: '2px solid ' + C.line,
          borderRadius: 16,
          background: C.card,
          padding: 22,
        },
        Stat('Premium', pos ? fmtBeta(pos.askPremium) + ' BETA' : '—', C.yield),
        box({ width: 2, background: C.line }),
        Stat('IL Mark', pos ? fmtBpsPct(pos.ilMarkBps) : '—', ilColor),
        box({ width: 2, background: C.line }),
        Stat('Liquidity', pos ? fmtBeta(pos.liquidity) : '—', C.bone),
      ),

      // flex spacer (marginTop: auto can be unreliable in Satori)
      box({ flex: 1 }),

      // footer
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
