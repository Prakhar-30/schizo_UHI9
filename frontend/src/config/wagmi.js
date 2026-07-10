import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { sepolia, unichainSepolia } from './chains'

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'schizo_demo_placeholder'

export const config = getDefaultConfig({
  appName: 'schizō',
  projectId,
  chains: [sepolia, unichainSepolia],
  transports: {
    [sepolia.id]: http(sepolia.rpcUrls.default.http[0]),
    [unichainSepolia.id]: http(unichainSepolia.rpcUrls.default.http[0]),
  },
  ssr: false,
})
