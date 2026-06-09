import { useMemo } from 'react'
import { sqrtPriceToPrice } from '../lib/il'
import { amountsForLiquidity } from '../lib/liquidity'
import { Kicker } from './ui/Bits'

/**
 * Outcome calculator: for a set of price-move scenarios, compute what the
 * impermanent-loss mark would become — relative to the position's entry
 * price, not the current price. Lets a hunter eyeball the *shape* of the
 * risk they're buying.
 */
const SCENARIOS = [
  { delta: -0.2, label: '−20%' },
  { delta: -0.1, label: '−10%' },
  { delta: 0, label: 'flat' },
  { delta: 0.1, label: '+10%' },
  { delta: 0.2, label: '+20%' },
]

function ilFromRatio(r) {
  if (!r || !isFinite(r) || r <= 0) return 0
  return 1 - (2 * Math.sqrt(r)) / (1 + r) // positive number = loss to IL-T
}

function fmtPrice(p) {
  if (!p || !isFinite(p)) return '–'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (p >= 1) return p.toPrecision(5).replace(/\.?0+$/, '')
  return p.toPrecision(3)
}

/**
 * The price band (entry-anchored) within which accrued IL stays *smaller* than
 * the premium the hunter paid — i.e. the buffer the premium buys. Because the
 * IL curve is symmetric (IL(r) = IL(1/r)), the band is symmetric in ratio
 * around the entry price. Solving 1 − 2√r/(1+r) = ilBE for r:
 *   x = √r,  x = (1 ± √(1−k²)) / k   with  k = 1 − ilBE
 */
function breakEvenBand(entry, current, askPremium, liquidity, currentSqrtPriceX96) {
  if (!entry || !current || !askPremium || !liquidity) return null
  const prem = Number(askPremium) // raw token1 (currency1) smallest units
  // Position value in the SAME unit (raw token1): amount1 + amount0 · rawPrice.
  // Comparing premium to raw liquidity L was dimensionally wrong (L ≠ token1
  // units on non-18-dec pools); this keeps both sides in token1 smallest units.
  let value = 0
  try {
    const { amount0, amount1 } = amountsForLiquidity(currentSqrtPriceX96, BigInt(liquidity))
    value = Number(amount1) + Number(amount0) * current // `current` = raw price (token1/token0)
  } catch {
    value = 0
  }
  if (!(value > 0) || !(prem > 0)) return null
  const ilBE = prem / value // IL fraction that exactly eats the premium
  if (ilBE >= 1) return null // premium >= principal: effectively unbreakable
  const k = 1 - ilBE
  const disc = 1 - k * k
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const rUp = ((1 + sq) / k) ** 2
  const rDown = ((1 - sq) / k) ** 2
  const priceUp = entry * rUp
  const priceDown = entry * rDown
  const inside = current >= priceDown && current <= priceUp
  return {
    ilBEPct: ilBE * 100,
    priceDown,
    priceUp,
    // headroom from *here* before the premium is exhausted, each direction
    moveUpPct: (priceUp / current - 1) * 100,
    moveDownPct: (priceDown / current - 1) * 100,
    inside,
  }
}

export default function OutcomeStrip({
  entrySqrtPriceX96,
  currentSqrtPriceX96,
  askPremium,
  liquidity,
  compact = false,
}) {
  const rows = useMemo(() => {
    const entry = sqrtPriceToPrice(entrySqrtPriceX96)
    const current = sqrtPriceToPrice(currentSqrtPriceX96)
    if (!entry || !current) return null
    return SCENARIOS.map((s) => {
      const newPrice = current * (1 + s.delta)
      const r = newPrice / entry
      const ilFrac = ilFromRatio(r) // positive
      return {
        label: s.label,
        delta: s.delta,
        ilPct: ilFrac * 100,
      }
    })
  }, [entrySqrtPriceX96, currentSqrtPriceX96])

  const band = useMemo(
    () =>
      breakEvenBand(
        sqrtPriceToPrice(entrySqrtPriceX96),
        sqrtPriceToPrice(currentSqrtPriceX96),
        askPremium,
        liquidity,
        currentSqrtPriceX96,
      ),
    [entrySqrtPriceX96, currentSqrtPriceX96, askPremium, liquidity],
  )

  if (!rows) {
    return (
      <div className={`${compact ? '' : 'card p-4'} font-mono text-[11px] text-bone/40`}>
        outcome math unavailable
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'card p-5'}>
      {!compact && (
        <div className="mb-3 flex items-baseline justify-between">
          <Kicker>If price moves from here…</Kicker>
          <span className="font-mono text-[10px] uppercase tracking-wider text-bone/30">
            entry-anchored
          </span>
        </div>
      )}
      <div className="grid grid-cols-5 gap-1.5">
        {rows.map((r) => {
          const sev = Math.min(1, r.ilPct / 12)
          const fg = r.ilPct < 1 ? 'text-yield' : r.ilPct < 4 ? 'text-amber' : 'text-risk'
          return (
            <div
              key={r.label}
              className="rounded-md border border-white/10 bg-ink-soft/50 px-1.5 py-2 text-center"
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-bone/45">
                {r.label}
              </div>
              <div className={`mt-0.5 font-mono text-[12px] font-bold tabular-nums ${fg}`}>
                −{r.ilPct.toFixed(r.ilPct < 1 ? 2 : 1)}%
              </div>
              {!compact && (
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/5">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${Math.max(4, sev * 100)}%`,
                      background: 'linear-gradient(90deg,#c6ff2e,#ffb020 55%,#ff2e6d)',
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {band && (
        <div
          className={`mt-3 rounded-md border px-3 py-2.5 ${
            band.inside
              ? 'border-yield/30 bg-yield/[0.06]'
              : 'border-risk/30 bg-risk/[0.06]'
          }`}
        >
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-bone/45">
              Premium break-even band
            </span>
            <span
              className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
                band.inside ? 'text-yield' : 'text-risk'
              }`}
            >
              {band.inside ? 'price inside · covered' : 'price outside · premium spent'}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-[12px] font-bold tabular-nums text-bone/80">
            {fmtPrice(band.priceDown)} <span className="text-bone/30">↔</span> {fmtPrice(band.priceUp)}
          </div>
          {!compact && (
            <div className="mt-1 font-mono text-[10px] tabular-nums text-bone/40">
              {band.moveDownPct.toFixed(1)}% / +{band.moveUpPct.toFixed(1)}% from here · IL absorbed up to{' '}
              {band.ilBEPct.toFixed(band.ilBEPct < 1 ? 2 : 1)}%
            </div>
          )}
        </div>
      )}
      {!compact && (
        <p className="mt-3 font-mono text-[10px] text-bone/35">
          IL is the loss vs holding the two tokens unchanged — your premium is your edge against it.
        </p>
      )}
    </div>
  )
}
