import { keccak256, encodeAbiParameters } from 'viem'
import { ADDR, DYNAMIC_FEE_FLAG, TICK_SPACING } from './contracts'

// The single dynamic-fee pool the hook manages. currency0 < currency1 by address.
export const POOL_KEY = {
  currency0: ADDR.token0,
  currency1: ADDR.token1,
  fee: DYNAMIC_FEE_FLAG,
  tickSpacing: TICK_SPACING,
  hooks: ADDR.hook,
}

// PoolId = keccak256(abi.encode(PoolKey)) — used to match SwapOccurred(poolId).
export const POOL_ID = keccak256(
  encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ],
    [POOL_KEY],
  ),
)
