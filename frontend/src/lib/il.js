// Math helpers for prices + impermanent loss.
// All sqrtPrice values are Uniswap Q64.96 fixed-point (uint160).

const Q96 = 2 ** 96

/** sqrtPriceX96 → RAW price (token1 per token0, in smallest units). Decimal-agnostic. */
export function sqrtPriceToPrice(sqrtPriceX96) {
  if (!sqrtPriceX96) return 0
  const s = Number(sqrtPriceX96) / Q96
  return s * s
}

/**
 * sqrtPriceX96 → HUMAN price = how many whole token1 per 1 whole token0.
 *   human = raw · 10^(dec0 - dec1)
 * Use this for any displayed price/rate on pools with mixed decimals.
 */
export function humanPrice(sqrtPriceX96, dec0 = 18, dec1 = 18) {
  return sqrtPriceToPrice(sqrtPriceX96) * 10 ** (Number(dec0) - Number(dec1))
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
