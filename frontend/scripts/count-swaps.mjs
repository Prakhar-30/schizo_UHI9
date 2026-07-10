import { createPublicClient, http, parseAbiItem } from 'viem'

const client = createPublicClient({ transport: http('https://ethereum-sepolia-rpc.publicnode.com') })
const HOOK = '0x57696AB5077Aa634c13682C3d3E84287935290c0'
const ev = parseAbiItem('event SwapOccurred(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick, uint128 liquidity)')

const labels = {
  '0x71540b47ef5680786153b43d49b46d3c23ca3ffb2c0b28cb875c078e8a3c600b': 'WETH/USDC',
  '0x5433b114a0cc035f0fd6f61ef7d7987314ce541ffa9e1c98fa894acfe48699d8': 'WBTC/USDT',
  '0x8d4683196016e93e0da736d43e97663e200f79de5e4f6aeb2275988e3a0e4e6b': 'WETH/DAI',
  '0xe859c020fc36c365a3cd6b38e445643130d2f13ab918c47e7f3e53b3548f4bce': 'LINK/WETH',
  '0xb47bf1c3c9864c2612575cc391e7b5d32788b1d3eb2af76d749a47283778132a': 'UNI/WETH',
  '0xaf9490a86d6c9f4905022fa944900b432ad7290237290cc575c470512b56077f': 'AAVE/WETH',
  '0x17f5bbc7d37f4b0144799cea8e60ba9a5584629458c99d769d684ae6602e8f2b': 'GHO/DAI',
  '0x2691074cfcc71be8f17cb9d5c44833460a90adbfda2bbc72d6dbb0474cccacb2': 'WBTC/WETH',
  '0xe2d7dc6ec7bb3180e337df2d090fbdeb4b8e05d4af68d7b27f8a481ef5b36390': 'EURS/WETH',
  '0xc7b544701fdc8ee307c375c75f2716862296fc0ce19c82ea235a82fdcc96ca54': 'USDC/DAI',
}

const head = await client.getBlockNumber()
const logs = await client.getLogs({ address: HOOK, event: ev, fromBlock: 11006000n, toBlock: head })
console.log(`head block: ${head}`)
console.log(`total SwapOccurred (new hook): ${logs.length}\n`)
const byPool = {}
for (const l of logs) byPool[l.args.poolId.toLowerCase()] = (byPool[l.args.poolId.toLowerCase()] || 0) + 1
for (const [id, n] of Object.entries(byPool)) console.log(`  ${labels[id] || id}: ${n}`)
const last = logs.at(-1)
if (last) console.log(`\nlatest swap at block ${last.blockNumber}`)
