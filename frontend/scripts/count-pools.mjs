import { createPublicClient, http, parseAbi, keccak256, encodeAbiParameters } from 'viem'

const c = createPublicClient({ transport: http('https://ethereum-sepolia-rpc.publicnode.com') })
const HOOK = '0x57696AB5077Aa634c13682C3d3E84287935290c0'
const SV = '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c'
const FEE = 0x800000, SPACING = 60
const svAbi = parseAbi(['function getLiquidity(bytes32 poolId) view returns (uint128)'])

const tokens = [
  '0x748b5C9623528D346C414F4f236B3b5b5c7683cb','0x912A7Fb66391eAe95DDee40B664FF497108580CD',
  '0x160fC2D6a542565ba7C2a57E18d6b28F62C8D0C7','0xCbAcA08f7eB9eB07537F344EbeC7E79302F60823',
  '0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba','0x00A311cd8BE35953635b0Bc619bdC807782dfC5E',
  '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357','0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E',
  '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8','0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
]
const T = [{type:'tuple',components:[{name:'currency0',type:'address'},{name:'currency1',type:'address'},{name:'fee',type:'uint24'},{name:'tickSpacing',type:'int24'},{name:'hooks',type:'address'}]}]
const pid = (a,b) => {
  const [c0,c1] = a.toLowerCase()<b.toLowerCase()?[a,b]:[b,a]
  return keccak256(encodeAbiParameters(T,[{currency0:c0,currency1:c1,fee:FEE,tickSpacing:SPACING,hooks:HOOK}]))
}
const ids = []
for (let i=0;i<tokens.length;i++) for (let j=i+1;j<tokens.length;j++) ids.push(pid(tokens[i],tokens[j]))

let seeded = 0
for (const id of ids) {
  try { const l = await c.readContract({address:SV,abi:svAbi,functionName:'getLiquidity',args:[id]}); if (l>0n) seeded++ } catch {}
}
console.log(`hook deployed code: ${(await c.getCode({address:HOOK}))?'YES':'not yet'}`)
console.log(`pools with liquidity: ${seeded} / ${ids.length}`)
