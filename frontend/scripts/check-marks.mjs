import { createPublicClient, http, parseAbi, keccak256, encodeAbiParameters } from 'viem'

const c = createPublicClient({ transport: http('https://ethereum-sepolia-rpc.publicnode.com') })
const HOOK = '0x58A3A816864F1E5f6F38F01f9f5AE1Cacc9210C0' // v3
const SV = '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c'
const FEE = 0x800000, SPACING = 60
const hookAbi = parseAbi([
  'function getPosition(uint256) view returns (address lp,address feeHolder,address ilHolder,bool active,bool ilBondSold,uint128 liquidity,uint160 entrySqrtPriceX96,int256 ilMarkBps,uint256 markValue,uint256 askPremium)',
  'function bundleCounter() view returns (uint256)',
  'function currentFee(bytes32) view returns (uint24)',
])
const svAbi = parseAbi(['function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 pf,uint24 lpFee)'])
const T = [{type:'tuple',components:[{name:'currency0',type:'address'},{name:'currency1',type:'address'},{name:'fee',type:'uint24'},{name:'tickSpacing',type:'int24'},{name:'hooks',type:'address'}]}]
const pid = (a,b) => { const [c0,c1]=a.toLowerCase()<b.toLowerCase()?[a,b]:[b,a]; return keccak256(encodeAbiParameters(T,[{currency0:c0,currency1:c1,fee:FEE,tickSpacing:SPACING,hooks:HOOK}])) }

const WETH='0x748b5C9623528D346C414F4f236B3b5b5c7683cb',WBTC='0x912A7Fb66391eAe95DDee40B664FF497108580CD'
const LINK='0x160fC2D6a542565ba7C2a57E18d6b28F62C8D0C7',UNI='0xCbAcA08f7eB9eB07537F344EbeC7E79302F60823'
const AAVE='0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba',GHO='0x00A311cd8BE35953635b0Bc619bdC807782dfC5E'
const pools = [
  { id: 0, label: 'WETH/WBTC (demo)', poolId: pid(WETH, WBTC) },
  { id: 1, label: 'LINK/UNI', poolId: pid(LINK, UNI) },
  { id: 2, label: 'AAVE/GHO', poolId: pid(AAVE, GHO) },
]
const Q96 = 2 ** 96
const ilPct = (e, c2) => { const r=(Number(c2)/Q96)**2/((Number(e)/Q96)**2); return (1-(2*Math.sqrt(r))/(1+r))*100 }

console.log('hook v3 bundleCounter:', (await c.readContract({ address: HOOK, abi: hookAbi, functionName: 'bundleCounter' })).toString())
for (const p of pools) {
  const pos = await c.readContract({ address: HOOK, abi: hookAbi, functionName: 'getPosition', args: [BigInt(p.id)] })
  const slot0 = await c.readContract({ address: SV, abi: svAbi, functionName: 'getSlot0', args: [p.poolId] })
  const fee = await c.readContract({ address: HOOK, abi: hookAbi, functionName: 'currentFee', args: [p.poolId] })
  console.log(`\n#${p.id} ${p.label}  sold=${pos[4]}`)
  console.log(`  live IL (computed): ${ilPct(pos[6], slot0[0]).toFixed(3)}%`)
  console.log(`  on-chain ilMarkBps (RSC): ${pos[7]} (${Number(pos[7]) / 100}%)`)
  console.log(`  live fee: ${(Number(fee) / 10000).toFixed(3)}%`)
}
