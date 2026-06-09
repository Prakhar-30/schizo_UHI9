import { createContext, useContext, useMemo } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { getNetwork, SUPPORTED_CHAIN_IDS, DEFAULT_CHAIN_ID } from '../config/networks'

const NetworkCtx = createContext(null)

/**
 * Provides the ACTIVE network config, resolved from the connected wallet's chain
 * (falling back to the default when disconnected or on an unsupported chain).
 * Every chain-specific address / token / pool / explorer flows from here, so the
 * Sepolia and Unichain deployments stay fully independent.
 */
export function NetworkProvider({ children }) {
  const { chainId: walletChainId } = useAccount()
  const configChainId = useChainId()
  const activeChainId = walletChainId ?? configChainId ?? DEFAULT_CHAIN_ID

  const value = useMemo(() => {
    const net = getNetwork(activeChainId)
    return {
      net,
      // true when the wallet is connected but on a chain we don't have a deployment for
      unsupported: walletChainId !== undefined && !SUPPORTED_CHAIN_IDS.includes(Number(walletChainId)),
    }
  }, [activeChainId, walletChainId])

  return <NetworkCtx.Provider value={value}>{children}</NetworkCtx.Provider>
}

/** The active network config (addresses, tokens, pools, explorer, chainId, …). */
export function useNetwork() {
  const ctx = useContext(NetworkCtx)
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider')
  return ctx.net
}

/** Whether the wallet is on a chain we don't support. */
export function useNetworkStatus() {
  const ctx = useContext(NetworkCtx)
  if (!ctx) throw new Error('useNetworkStatus must be used within NetworkProvider')
  return ctx
}
