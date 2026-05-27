import { defineChain } from 'viem'
import { sepolia as wagmiSepolia } from 'wagmi/chains'

const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'
const LASNA_RPC = import.meta.env.VITE_LASNA_RPC || 'https://lasna-rpc.rnk.dev/'
// Dedicated endpoint for eth_getLogs — many providers (incl. Alchemy free tier)
// cap log queries to ~10 blocks, so the activity feed reads from a permissive
// public RPC instead of the main Sepolia transport.
export const LOG_RPC = import.meta.env.VITE_LOG_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'

// Ethereum Sepolia — where ILBondHook + the V4 pool live.
export const sepolia = {
  ...wagmiSepolia,
  rpcUrls: {
    ...wagmiSepolia.rpcUrls,
    default: { http: [SEPOLIA_RPC] },
  },
}

// Reactive Network — Lasna testnet, where ILBondReactive marks IL to market.
export const lasna = defineChain({
  id: 5318007,
  name: 'Reactive Lasna',
  network: 'reactive-lasna',
  nativeCurrency: { name: 'REACT', symbol: 'REACT', decimals: 18 },
  rpcUrls: {
    default: { http: [LASNA_RPC] },
    public: { http: [LASNA_RPC] },
  },
  blockExplorers: {
    default: { name: 'Reactscan', url: 'https://lasna.reactscan.net' },
  },
  testnet: true,
})

export const RPC = { SEPOLIA_RPC, LASNA_RPC }
