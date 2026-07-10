// Uniswap v4 exact-input quoting in BigInt: SqrtPriceMath + SwapMath for one
// step with L held constant. Exact for full-range liquidity (no tick crossings),
// a close estimate otherwise.

const Q96 = 2n ** 96n
const FEE_DENOM = 1_000_000n // v4 fee unit: 1e6 = 100%

const mulDiv = (a, b, d) => (a * b) / d
const mulDivRoundingUp = (a, b, d) => {
  const p = a * b
  return p / d + (p % d > 0n ? 1n : 0n)
}

// getNextSqrtPriceFromAmount0RoundingUp (exact-in, token0 added → price falls)
function nextSqrtFromAmount0(sqrtP, L, amount) {
  if (amount === 0n) return sqrtP
  const numerator1 = L << 96n
  const denominator = numerator1 + amount * sqrtP
  return mulDivRoundingUp(numerator1, sqrtP, denominator)
}

// getNextSqrtPriceFromAmount1RoundingDown (exact-in, token1 added → price rises)
function nextSqrtFromAmount1(sqrtP, L, amount) {
  if (amount === 0n) return sqrtP
  return sqrtP + (amount * Q96) / L
}

// getAmount0Delta, rounded down (output side)
function amount0Delta(sqrtA, sqrtB, L) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]
  const numerator1 = L << 96n
  const numerator2 = sqrtB - sqrtA
  return mulDiv(numerator1, numerator2, sqrtB) / sqrtA
}

// getAmount1Delta, rounded down (output side)
function amount1Delta(sqrtA, sqrtB, L) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]
  return (L * (sqrtB - sqrtA)) / Q96
}

/**
 * Quote an exact-input v4 swap.
 * @param {bigint} amountIn      input amount (wei)
 * @param {bigint} sqrtPriceX96  current pool sqrt price (Q64.96)
 * @param {bigint} liquidity     current active liquidity L
 * @param {number|bigint} feePips swap fee in pips (e.g. 3000 = 0.30%)
 * @param {boolean} zeroForOne   true = token0 → token1
 * @returns {{ amountOut: bigint, sqrtPriceAfter: bigint }}
 */
export function quoteExactInput({ amountIn, sqrtPriceX96, liquidity, feePips, zeroForOne }) {
  const L = BigInt(liquidity ?? 0n)
  const sqrtP = BigInt(sqrtPriceX96 ?? 0n)
  const amt = BigInt(amountIn ?? 0n)
  const fee = BigInt(feePips ?? 0n)
  if (L <= 0n || sqrtP <= 0n || amt <= 0n) return { amountOut: 0n, sqrtPriceAfter: sqrtP }

  // Fee is taken off the input first (as in SwapMath.computeSwapStep).
  const amountLessFee = (amt * (FEE_DENOM - fee)) / FEE_DENOM

  let sqrtNext, amountOut
  if (zeroForOne) {
    sqrtNext = nextSqrtFromAmount0(sqrtP, L, amountLessFee)
    amountOut = amount1Delta(sqrtNext, sqrtP, L)
  } else {
    sqrtNext = nextSqrtFromAmount1(sqrtP, L, amountLessFee)
    amountOut = amount0Delta(sqrtP, sqrtNext, L)
  }
  return { amountOut, sqrtPriceAfter: sqrtNext }
}
