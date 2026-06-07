import { createPublicClient, http, parseAbi } from 'viem'

const c = createPublicClient({ transport: http('https://ethereum-sepolia-rpc.publicnode.com') })
const HOOK = '0x9D19eA2aad6c8748d566f28fe375fb8BCAA350c0'
const SV = '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c'
const hookAbi = parseAbi([
  'function getPosition(uint256) view returns (address lp,address feeHolder,address ilHolder,bool active,bool ilBondSold,uint128 liquidity,uint160 entrySqrtPriceX96,int256 ilMarkBps,uint256 markValue,uint256 askPremium)',
  'function bundleCounter() view returns (uint256)',
  'function currentFee(bytes32) view returns (uint24)',
])
const svAbi = parseAbi(['function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 pf,uint24 lpFee)'])

const pools = [
  { id: 0, label: 'WBTC/WETH', poolId: '0x2691074cfcc71be8f17cb9d5c44833460a90adbfda2bbc72d6dbb0474cccacb2' },
  { id: 1, label: 'AAVE/WETH', poolId: '0xaf9490a86d6c9f4905022fa944900b432ad7290237290cc575c470512b56077f' },
  { id: 2, label: 'EURS/WETH', poolId: '0xe2d7dc6ec7bb3180e337df2d090fbdeb4b8e05d4af68d7b27f8a481ef5b36390' },
]
const Q96 = 2 ** 96
const ilPct = (entry, cur) => {
  const r = (Number(cur) / Q96) ** 2 / ((Number(entry) / Q96) ** 2)
  return (1 - (2 * Math.sqrt(r)) / (1 + r)) * 100
}

console.log('bundleCounter:', (await c.readContract({ address: HOOK, abi: hookAbi, functionName: 'bundleCounter' })).toString())
for (const p of pools) {
  const pos = await c.readContract({ address: HOOK, abi: hookAbi, functionName: 'getPosition', args: [BigInt(p.id)] })
  const slot0 = await c.readContract({ address: SV, abi: svAbi, functionName: 'getSlot0', args: [p.poolId] })
  const fee = await c.readContract({ address: HOOK, abi: hookAbi, functionName: 'currentFee', args: [p.poolId] })
  const entry = pos[6], cur = slot0[0], onChainMark = pos[7]
  console.log(`\n#${p.id} ${p.label}`)
  console.log(`  entrySqrt=${entry}  curSqrt=${cur}`)
  console.log(`  live IL (computed): ${ilPct(entry, cur).toFixed(3)}%`)
  console.log(`  on-chain ilMarkBps (RSC): ${onChainMark} (${Number(onChainMark) / 100}%)`)
  console.log(`  live fee: ${(Number(fee) / 10000).toFixed(3)}%`)
}
