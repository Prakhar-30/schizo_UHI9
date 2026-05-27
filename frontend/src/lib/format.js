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
