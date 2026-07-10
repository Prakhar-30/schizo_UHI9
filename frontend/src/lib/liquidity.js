// Uniswap LiquidityAmounts math (Q64.96) in BigInt.
// Used to estimate the token amounts a full-range deposit will pull,
// so we can set a safe amount0Max / amount1Max.

const Q96 = 2n ** 96n
// Full-range bounds - using TickMath MIN/MAX sqrt prices slightly overestimates
// the real [-887220, 887220] requirement, which keeps our Max amounts safe.
export const MIN_SQRT = 4295128739n
export const MAX_SQRT = 1461446703485210103287273052203988822378723970342n

function amount0For(sqrtA, sqrtB, L) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]
  if (sqrtA === 0n) return 0n
  return (L * Q96 * (sqrtB - sqrtA)) / sqrtB / sqrtA
}

function amount1For(sqrtA, sqrtB, L) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]
  return (L * (sqrtB - sqrtA)) / Q96
}

/** Returns { amount0, amount1 } needed to mint `L` over full range at `sqrtP`. */
export function amountsForLiquidity(sqrtP, L) {
  if (!L || L <= 0n) return { amount0: 0n, amount1: 0n }
  const p = BigInt(sqrtP)
  if (p <= MIN_SQRT) return { amount0: amount0For(MIN_SQRT, MAX_SQRT, L), amount1: 0n }
  if (p >= MAX_SQRT) return { amount0: 0n, amount1: amount1For(MIN_SQRT, MAX_SQRT, L) }
  return {
    amount0: amount0For(p, MAX_SQRT, L),
    amount1: amount1For(MIN_SQRT, p, L),
  }
}

/** Add a small buffer so rounding never starves modifyLiquidity. */
export function withBuffer(x, bps = 200n) {
  return (x * (10000n + bps)) / 10000n + 1n
}

// Inverse: token amount → liquidity, so Create can accept real decimal-correct
// token amounts instead of raw L (absurd on non-18-dec pools).

function liquidityForAmount0(sqrtA, sqrtB, amount0) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]
  if (sqrtA === 0n || sqrtB === sqrtA) return 0n
  const intermediate = (sqrtA * sqrtB) / Q96
  return (amount0 * intermediate) / (sqrtB - sqrtA)
}

function liquidityForAmount1(sqrtA, sqrtB, amount1) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]
  if (sqrtB === sqrtA) return 0n
  return (amount1 * Q96) / (sqrtB - sqrtA)
}

/**
 * Liquidity obtainable from `amount0` of token0 deposited full-range at `sqrtP`.
 * In range, token0 occupies [sqrtP, upper]. If price has run past the range we
 * fall back to the whole-range bound so the result is still finite.
 */
export function liquidityForToken0(sqrtP, amount0) {
  if (!amount0 || amount0 <= 0n) return 0n
  const p = BigInt(sqrtP)
  if (p >= MAX_SQRT) return liquidityForAmount0(MIN_SQRT, MAX_SQRT, amount0)
  if (p <= MIN_SQRT) return liquidityForAmount0(MIN_SQRT, MAX_SQRT, amount0)
  return liquidityForAmount0(p, MAX_SQRT, amount0)
}

/**
 * Liquidity obtainable from `amount1` of token1 deposited full-range at `sqrtP`.
 * In range, token1 occupies [lower, sqrtP].
 */
export function liquidityForToken1(sqrtP, amount1) {
  if (!amount1 || amount1 <= 0n) return 0n
  const p = BigInt(sqrtP)
  if (p <= MIN_SQRT) return liquidityForAmount1(MIN_SQRT, MAX_SQRT, amount1)
  if (p >= MAX_SQRT) return liquidityForAmount1(MIN_SQRT, MAX_SQRT, amount1)
  return liquidityForAmount1(MIN_SQRT, p, amount1)
}
