//  NETWORK REGISTRY
//  Each supported chain holds its own ILBondHook deployment: addresses, tokens,
//  pools, explorer, deploy block, and a log-RPC. The app resolves the ACTIVE
//  network from the connected wallet chain (config/NetworkContext) and reads
//  everything from here - so switching chains switches the whole system, and the
//  two deployments never affect each other.
import { ADDR } from './contracts'
import { sepolia, unichainSepolia } from './chains'
import { SEPOLIA_RAW_TOKENS, buildPoolRegistry } from './pools'

// Unichain Sepolia (1301) - second, independent deployment (mock tokens, fresh hook).
const UNICHAIN_RAW_TOKENS = [
  { address: '0xC72377c60F46b7Bf812A55728d3b4c57b7Be692e', symbol: 'mWETH', name: 'Mock Wrapped Ether', decimals: 18, mintable: true },
  { address: '0x18CF733BD208ff54d4855bcA459F5099f38d4f2C', symbol: 'mWBTC', name: 'Mock Wrapped BTC', decimals: 8, mintable: true },
  { address: '0xdC37BdfDf525769f96d46728aC8caC82823b69D3', symbol: 'mUSDC', name: 'Mock USD Coin', decimals: 6, mintable: true },
]

const RAW = {
  11155111: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    short: 'Sepolia',
    addr: {
      hook: ADDR.hook,
      poolManager: ADDR.poolManager,
      stateView: ADDR.stateView,
      swapRouter: ADDR.swapRouter,
      positionManager: ADDR.positionManager,
      permit2: ADDR.permit2,
    },
    rawTokens: SEPOLIA_RAW_TOKENS,
    demoPair: ['WETH', 'WBTC'],
    deployBlock: 11239703n,
    explorer: 'https://sepolia.etherscan.io',
    logRpc: import.meta.env.VITE_LOG_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    viemChain: sepolia,
  },
  1301: {
    chainId: 1301,
    name: 'Unichain Sepolia',
    short: 'Unichain',
    addr: {
      hook: '0x20487A756FececfF800d15EC76C78e0487A2D0c0',
      poolManager: '0x00B036B58a818B1BC34d502D3fE730Db729e62AC',
      stateView: '0xc199F1072a74D4e905ABa1A84d9a45E2546B6222',
      swapRouter: '0x9cD2b0a732dd5e023a5539921e0FD1c30E198Dba',
      positionManager: '0xf969Aee60879C54bAAed9F3eD26147Db216Fd664',
      permit2: ADDR.permit2, // canonical, same address on every chain
    },
    rawTokens: UNICHAIN_RAW_TOKENS,
    demoPair: ['mWETH', 'mUSDC'],
    deployBlock: 56790639n,
    explorer: 'https://sepolia.uniscan.xyz',
    logRpc: import.meta.env.VITE_UNICHAIN_RPC || 'https://sepolia.unichain.org',
    viemChain: unichainSepolia,
  },
}

export const DEFAULT_CHAIN_ID = 11155111
export const SUPPORTED_CHAIN_IDS = Object.keys(RAW).map(Number)

const cache = {}

/** Resolve the full, ready-to-use config for a chain (defaults to Sepolia). */
export function getNetwork(chainId) {
  const id = SUPPORTED_CHAIN_IDS.includes(Number(chainId)) ? Number(chainId) : DEFAULT_CHAIN_ID
  if (cache[id]) return cache[id]
  const raw = RAW[id]
  const reg = buildPoolRegistry({ rawTokens: raw.rawTokens, hook: raw.addr.hook, demoPair: raw.demoPair })
  const net = {
    ...raw,
    ...reg, // tokens, getToken, pools, poolsById, demoPool, getPoolById
    txUrl: (h) => `${raw.explorer}/tx/${h}`,
    addrUrl: (a) => `${raw.explorer}/address/${a}`,
  }
  cache[id] = net
  return net
}
