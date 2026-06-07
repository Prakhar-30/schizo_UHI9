// Definitive: read the realized `fee` field from PoolManager Swap events.
import { createPublicClient, http, parseAbiItem, keccak256, encodeAbiParameters } from 'viem'

const client = createPublicClient({ transport: http('https://ethereum-sepolia-rpc.publicnode.com') })
const POOL_MANAGER = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'
const POOL_KEY = {
  currency0: '0x1E0a671C889e49fA2Ecf2F07E3930cd9B11E3591',
  currency1: '0x9a731FC6652C8cc101ABcB0717d808ab09397aB9',
  fee: 0x800000, tickSpacing: 60, hooks: '0x55f571E0DC76De9154DeA40B4749a6449CF510C0',
}
const POOL_ID = keccak256(encodeAbiParameters(
  [{ type: 'tuple', components: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
  ]}], [POOL_KEY]))

const swapEvent = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)'
)

const latest = await client.getBlockNumber()
const CHUNK = 9000n
let all = []
// scan back up to ~14 windows (~126k blocks ≈ 17 days)
for (let i = 0; i < 14 && all.length < 30; i++) {
  const to = latest - CHUNK * BigInt(i)
  const from = to - CHUNK + 1n
  try {
    const logs = await client.getLogs({ address: POOL_MANAGER, event: swapEvent, args: { id: POOL_ID }, fromBlock: from, toBlock: to })
    if (logs.length) { console.log(`  [${from}-${to}] ${logs.length} swaps`); all = all.concat(logs) }
  } catch (e) { console.log(`  [${from}-${to}] err ${e.shortMessage || e.message}`) }
}

all.sort((a, b) => Number(a.blockNumber - b.blockNumber))
console.log(`\nTotal Swap events found: ${all.length}`)
const fees = new Set()
for (const l of all.slice(-20)) {
  console.log(`  block ${l.blockNumber}  fee=${l.args.fee} pips (${Number(l.args.fee)/10000}%)  tick=${l.args.tick}`)
  fees.add(Number(l.args.fee))
}
console.log('\nDistinct fee values observed:', [...fees])
console.log(fees.size <= 1 ? '=> Fee is CONSTANT (static value, only "dynamic" by pool type).' : '=> Fee VARIES across swaps (truly dynamic).')
