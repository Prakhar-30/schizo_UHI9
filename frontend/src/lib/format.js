import { formatUnits } from 'viem'

export const shortAddr = (a, n = 4) =>
  a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : ''

export const isSameAddr = (a, b) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

const ZERO = '0x0000000000000000000000000000000000000000'
export const isZero = (a) => !a || a.toLowerCase() === ZERO

/** Format a bigint token amount with grouped, trimmed decimals. */
export function fmtToken(value, decimals = 18, maxFrac = 4) {
  if (value === undefined || value === null) return '—'
  let s
  try {
    s = formatUnits(typeof value === 'bigint' ? value : BigInt(value), decimals)
  } catch {
    return '—'
  }
  const n = Number(s)
  if (!isFinite(n)) return s
  if (n !== 0 && Math.abs(n) < 0.0001) return '<0.0001'
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac })
}

export function fmtNum(n, maxFrac = 2) {
  if (n === undefined || n === null || !isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: maxFrac })
}

/**
 * Compact a (possibly enormous) value into K / M / B / T, falling back to
 * scientific notation past 1e15. Used for raw liquidity (L) which can be huge.
 */
export function fmtCompact(value, decimals = 0) {
  if (value === undefined || value === null) return '—'
  let n
  try {
    n = typeof value === 'bigint' ? Number(formatUnits(value, decimals)) : Number(value)
  } catch {
    return '—'
  }
  if (!isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e27) return n.toExponential(2)
  const units = [
    { v: 1e24, s: 'Y' },
    { v: 1e21, s: 'Z' },
    { v: 1e18, s: 'E' },
    { v: 1e15, s: 'P' },
    { v: 1e12, s: 'T' },
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ]
  for (const u of units) {
    if (abs >= u.v) return (n / u.v).toFixed(2).replace(/\.?0+$/, '') + u.s
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** signed bps (e.g. -468) → "-4.68%" */
export function fmtBpsPct(bps) {
  if (bps === undefined || bps === null) return '—'
  const n = Number(bps) / 100
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export function timeAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
