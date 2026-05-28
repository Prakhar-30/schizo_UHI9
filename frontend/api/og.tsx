import { ImageResponse } from '@vercel/og'
import { createPublicClient, http, parseAbi } from 'viem'
import { sepolia } from 'viem/chains'

export const config = { runtime: 'edge' }

// Hardcoded so the edge function has zero coupling to the Vite src tree.
// Keep in sync with frontend/src/config/contracts.js if the hook is redeployed.
const HOOK = '0x55f571E0DC76De9154DeA40B4749a6449CF510C0'
const RPC = process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'

const HOOK_ABI = parseAbi([
  'function getPosition(uint256 positionId) view returns (address lp, address feeHolder, address ilHolder, bool active, bool ilBondSold, uint128 liquidity, uint160 entrySqrtPriceX96, int256 ilMarkBps, uint256 markValue, uint256 askPremium)',
])

const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

const COLORS = {
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
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export default async function handler(req) {
  const url = new URL(req.url)
  const idParam = url.searchParams.get('id') || '0'
  const id = idParam.replace(/[^0-9]/g, '') || '0'

  let pos = null
  try {
    const r = await client.readContract({
      address: HOOK,
      abi: HOOK_ABI,
      functionName: 'getPosition',
      args: [BigInt(id)],
    })
    // Treat zero-LP as "not minted"
    if (r[0] !== '0x0000000000000000000000000000000000000000') {
      pos = {
        active: r[3],
        ilBondSold: r[4],
        liquidity: r[5],
        ilMarkBps: r[7],
        askPremium: r[9],
      }
    }
  } catch (e) {
    pos = null
  }

  const ilNum = pos ? Number(pos.ilMarkBps) : 0
  const ilColor = !pos ? COLORS.mute : ilNum <= -400 ? COLORS.risk : ilNum <= -100 ? COLORS.amber : COLORS.yield
  const statusColor = !pos ? COLORS.mute : pos.ilBondSold ? COLORS.risk : COLORS.amber
  const statusLabel = !pos ? 'NOT FOUND' : pos.ilBondSold ? 'IL-T SOLD' : 'IL-T OPEN'

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: COLORS.ink,
          color: COLORS.bone,
          padding: '64px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* faint grid */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
            opacity: 0.5,
          }}
        />
        {/* glow */}
        <div
          style={{
            position: 'absolute',
            right: -120,
            bottom: -160,
            width: 520,
            height: 520,
            display: 'flex',
            background: `radial-gradient(circle at center, ${ilColor}33, transparent 70%)`,
          }}
        />

        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              display: 'flex',
              background: `linear-gradient(135deg, ${COLORS.volt}, ${COLORS.risk})`,
              boxShadow: '4px 4px 0 0 #000',
            }}
          />
          <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1 }}>schizō</div>
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 14px',
              border: `2px solid ${COLORS.volt}66`,
              color: COLORS.volt,
              borderRadius: 8,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
            }}
          >
            <div style={{ width: 8, height: 8, background: COLORS.volt, borderRadius: '50%', display: 'flex' }} />
            Reactive Network
          </div>
        </div>

        {/* id + chip */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 70 }}>
          <div
            style={{
              fontSize: 22,
              color: COLORS.mute,
              textTransform: 'uppercase',
              letterSpacing: '0.32em',
              fontWeight: 700,
            }}
          >
            IL Bond Position
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginTop: 8 }}>
            <div style={{ fontSize: 200, fontWeight: 900, lineHeight: 0.95, letterSpacing: -6 }}>#{id}</div>
            <div
              style={{
                display: 'flex',
                padding: '14px 22px',
                border: `2px solid ${statusColor}`,
                color: statusColor,
                borderRadius: 12,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '0.18em',
                marginBottom: 10,
              }}
            >
              {statusLabel}
            </div>
          </div>
        </div>

        {/* stats grid */}
        <div
          style={{
            display: 'flex',
            gap: 24,
            marginTop: 50,
            border: `2px solid ${COLORS.line}`,
            borderRadius: 18,
            background: COLORS.card,
            padding: 28,
          }}
        >
          <Stat label="Premium" value={pos ? `${fmtBeta(pos.askPremium)} BETA` : '—'} color={COLORS.yield} />
          <div style={{ width: 2, background: COLORS.line, display: 'flex' }} />
          <Stat label="IL Mark" value={pos ? fmtBpsPct(pos.ilMarkBps) : '—'} color={ilColor} />
          <div style={{ width: 2, background: COLORS.line, display: 'flex' }} />
          <Stat label="Liquidity" value={pos ? fmtBeta(pos.liquidity) : '—'} color={COLORS.bone} />
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
          <div
            style={{
              fontSize: 22,
              color: COLORS.mute,
              textTransform: 'uppercase',
              letterSpacing: '0.28em',
              fontWeight: 700,
            }}
          >
            LP fees · without the impermanent loss
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 10, height: 10, background: COLORS.mint, borderRadius: '50%', display: 'flex' }} />
            <div style={{ fontSize: 18, color: COLORS.mute, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              Sepolia · marked by RSC
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
      <div
        style={{
          fontSize: 18,
          color: COLORS.mute,
          textTransform: 'uppercase',
          letterSpacing: '0.32em',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 56, fontWeight: 800, color, letterSpacing: -1 }}>{value}</div>
    </div>
  )
}
