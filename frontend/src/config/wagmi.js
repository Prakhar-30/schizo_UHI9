import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { sepolia, unichainSepolia, lasna } from './chains'

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'schizo_demo_placeholder'

export const config = getDefaultConfig({
  appName: 'schizō',
  projectId,
  chains: [sepolia, unichainSepolia, lasna],
  transports: {
    [sepolia.id]: http(sepolia.rpcUrls.default.http[0]),
    [unichainSepolia.id]: http(unichainSepolia.rpcUrls.default.http[0]),
    [lasna.id]: http(lasna.rpcUrls.default.http[0]),
  },
  ssr: false,
})
