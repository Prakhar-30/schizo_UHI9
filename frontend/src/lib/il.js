// Math helpers for prices + impermanent loss.
// All sqrtPrice values are Uniswap Q64.96 fixed-point (uint160).

import { decodeAbiParameters } from 'viem'

const Q96 = 2 ** 96

/** sqrtPriceX96 → price of token0 denominated in token1 (assumes equal decimals). */
export function sqrtPriceToPrice(sqrtPriceX96) {
  if (!sqrtPriceX96) return 0
  const s = Number(sqrtPriceX96) / Q96
  return s * s
}

/**
 * Impermanent loss vs HODL, given entry and current sqrt prices.
 * IL = 1 - 2*sqrt(r)/(1+r),  r = currentPrice / entryPrice.
 * Returns a NEGATIVE fraction (loss), matching the on-chain signed mark.
 */
export function computeIL(entrySqrtPriceX96, currentSqrtPriceX96) {
  const entry = sqrtPriceToPrice(entrySqrtPriceX96)
  const cur = sqrtPriceToPrice(currentSqrtPriceX96)
  if (!entry || !cur) return 0
  const r = cur / entry
  const il = 1 - (2 * Math.sqrt(r)) / (1 + r)
  return -il // negative = loss to the IL-T holder
}

/** Percentage price move from entry → current (signed). */
export function priceMovePct(entrySqrtPriceX96, currentSqrtPriceX96) {
  const entry = sqrtPriceToPrice(entrySqrtPriceX96)
  const cur = sqrtPriceToPrice(currentSqrtPriceX96)
  if (!entry || !cur) return 0
  return (cur / entry - 1) * 100
}

/** Map IL bps magnitude → a 0..1 severity for gauges/colors. */
export function ilSeverity(bps) {
  const mag = Math.abs(Number(bps || 0)) / 100 // percent
  // 0% → 0, ~15%+ → 1
  return Math.min(1, mag / 15)
}

// ─────────────────────────────────────────────────────────────────────────────
//  ILBondDataBundle decoding — derive IL marks from the bundle the RSC emits.
//
//  The RSC's mark-settlement leg (settleILMark → ILMarkUpdated) can lag or stall
//  while the hook keeps emitting ILBondDataBundle every swap cycle. The bundle
//  carries everything needed to reproduce the mark (current price + each open
//  position's entry/range/liquidity), so we compute the same value the RSC would
//  have posted — mirroring ILBondReactive._computeILMark exactly.
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors ILBondHook.PositionData, wrapped as `abi.encode(uint160 currentSqrt, PositionData[])`.
const BUNDLE_ABI = [
  { type: 'uint160' },
  {
    type: 'tuple[]',
    components: [
      { name: 'positionId', type: 'uint256' },
      { name: 'entrySqrtPriceX96', type: 'uint160' },
      { name: 'sqrtPriceLower', type: 'uint160' },
      { name: 'sqrtPriceUpper', type: 'uint160' },
      { name: 'liquidity', type: 'uint128' },
    ],
  },
]

/**
 * Decode an ILBondDataBundle event's `data` bytes.
 * Returns `{ currentSqrt, positions }` or null if it can't be decoded.
 */
export function decodeBundle(dataHex) {
  if (!dataHex) return null
  try {
    const [currentSqrt, positions] = decodeAbiParameters(BUNDLE_ABI, dataHex)
    return { currentSqrt, positions }
  } catch {
    return null
  }
}

/**
 * Compute the IL mark for one position from a bundle, matching the on-chain RSC:
 *   ilBps     = -round((1 - 2√r/(1+r)) * 10000),  r = currentP / entryP
 *   markValue = liquidity * (BPS - |ilBps|) / BPS   (token1-equivalent estimate)
 * Returns `{ ilBps, markValue }` (BigInt markValue) or null if the position isn't
 * in the bundle / has no liquidity.
 */
export function bundleMark(dataHex, positionId) {
  const b = decodeBundle(dataHex)
  if (!b) return null
  const p = b.positions.find((x) => Number(x.positionId) === Number(positionId))
  if (!p || !p.liquidity || !p.entrySqrtPriceX96 || !b.currentSqrt) return null
  const ilFraction = -computeIL(p.entrySqrtPriceX96, b.currentSqrt) // non-negative magnitude
  const ilMag = Math.max(0, Math.round(ilFraction * 10000))
  const ilBps = -ilMag
  const markValue = (p.liquidity * BigInt(10000 - ilMag)) / 10000n
  return { ilBps, markValue }
}
