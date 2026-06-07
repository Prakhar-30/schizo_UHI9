// One-off on-chain verification: is the hook live, and is the fee actually dynamic?
import { createPublicClient, http, parseAbi, keccak256, encodeAbiParameters } from 'viem'

const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const client = createPublicClient({ transport: http(RPC) })

const ADDR = {
  hook: '0x55f571E0DC76De9154DeA40B4749a6449CF510C0',
  token0: '0x1E0a671C889e49fA2Ecf2F07E3930cd9B11E3591',
  token1: '0x9a731FC6652C8cc101ABcB0717d808ab09397aB9',
  poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
  stateView: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c',
}
const DYNAMIC_FEE_FLAG = 0x800000
const TICK_SPACING = 60

const POOL_KEY = {
  currency0: ADDR.token0,
  currency1: ADDR.token1,
  fee: DYNAMIC_FEE_FLAG,
  tickSpacing: TICK_SPACING,
  hooks: ADDR.hook,
}
const POOL_ID = keccak256(
  encodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ]}],
    [POOL_KEY],
  ),
)

const HOOK_ABI = parseAbi([
  'function nextPositionId() view returns (uint256)',
  'function activePositionCount() view returns (uint256)',
  'function bundleCounter() view returns (uint256)',
  'function BASE_FEE() view returns (uint24)',
  'function getPosition(uint256 positionId) view returns (address lp, address feeHolder, address ilHolder, bool active, bool ilBondSold, uint128 liquidity, uint160 entrySqrtPriceX96, int256 ilMarkBps, uint256 markValue, uint256 askPremium)',
])
const STATEVIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
])

const hook = (functionName, args) => client.readContract({ address: ADDR.hook, abi: HOOK_ABI, functionName, args })
const sv = (functionName, args) => client.readContract({ address: ADDR.stateView, abi: STATEVIEW_ABI, functionName, args })

console.log('POOL_ID:', POOL_ID)
console.log('block  :', (await client.getBlockNumber()).toString())

const [nextId, active, bundles, baseFee] = await Promise.all([
  hook('nextPositionId'), hook('activePositionCount'), hook('bundleCounter'), hook('BASE_FEE'),
])
console.log('\n── HOOK STATE ───────────────────────────────')
console.log('nextPositionId     :', nextId.toString())
console.log('activePositionCount:', active.toString())
console.log('bundleCounter      :', bundles.toString())
console.log('BASE_FEE (pips)    :', baseFee.toString(), `( ${Number(baseFee) / 10000}% )`)

const [slot0, liq] = await Promise.all([ sv('getSlot0', [POOL_ID]), sv('getLiquidity', [POOL_ID]) ])
console.log('\n── POOL slot0 (live) ────────────────────────')
console.log('sqrtPriceX96 :', slot0[0].toString())
console.log('tick         :', slot0[1])
console.log('protocolFee  :', slot0[2])
console.log('lpFee (slot0):', slot0[3], '  <-- the pool-stored dynamic fee')
console.log('liquidity    :', liq.toString())

console.log('\n── SAMPLE POSITIONS ─────────────────────────')
const n = Math.min(Number(nextId), 5)
for (let i = 0; i < n; i++) {
  const p = await hook('getPosition', [BigInt(i)])
  console.log(`#${i}: active=${p[3]} sold=${p[4]} liq=${p[5]} ilMarkBps=${p[7]} mark=${p[8]} ask=${p[9]}`)
}
