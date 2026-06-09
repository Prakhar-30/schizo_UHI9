import { defineChain } from 'viem'
import { sepolia as wagmiSepolia } from 'wagmi/chains'

const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'
const LASNA_RPC = import.meta.env.VITE_LASNA_RPC || 'https://lasna-rpc.rnk.dev/'
const UNICHAIN_RPC = import.meta.env.VITE_UNICHAIN_RPC || 'https://sepolia.unichain.org'
// Dedicated endpoint for eth_getLogs — many providers (incl. Alchemy free tier)
// cap log queries to ~10 blocks, so the activity feed reads from a permissive
// public RPC instead of the main Sepolia transport.
export const LOG_RPC = import.meta.env.VITE_LOG_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'

// Ethereum Sepolia — where the original ILBondHook + 45 pools live.
export const sepolia = {
  ...wagmiSepolia,
  rpcUrls: {
    ...wagmiSepolia.rpcUrls,
    default: { http: [SEPOLIA_RPC] },
  },
}

// Unichain Sepolia — second, independent ILBondHook deployment.
export const unichainSepolia = defineChain({
  id: 1301,
  name: 'Unichain Sepolia',
  network: 'unichain-sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [UNICHAIN_RPC] },
    public: { http: [UNICHAIN_RPC] },
  },
  blockExplorers: {
    default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' },
  },
  testnet: true,
})

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
