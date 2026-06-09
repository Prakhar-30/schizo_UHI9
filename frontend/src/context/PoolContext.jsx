import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useNetwork } from './NetworkContext'

const PoolCtx = createContext(null)
const storageKey = (chainId) => `schizo.selectedPoolId.${chainId}`

export function PoolProvider({ children }) {
  const net = useNetwork()
  const [poolId, setPoolIdState] = useState(net.demoPool.id)

  // When the active network changes, restore that chain's saved pool (or default
  // to its demo pool). Keeps the two deployments' selections independent.
  useEffect(() => {
    let next = net.demoPool.id
    try {
      const saved = localStorage.getItem(storageKey(net.chainId))
      if (saved && net.getPoolById(saved)) next = saved
    } catch {
      /* ignore */
    }
    setPoolIdState(next)
  }, [net])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(net.chainId), poolId)
    } catch {
      /* ignore */
    }
  }, [poolId, net])

  const setPoolId = (id) => {
    if (net.getPoolById(id)) setPoolIdState(id)
  }

  const value = useMemo(
    () => ({ pool: net.getPoolById(poolId) || net.demoPool, poolId, setPoolId, pools: net.pools }),
    [poolId, net],
  )
  return <PoolCtx.Provider value={value}>{children}</PoolCtx.Provider>
}

export function usePool() {
  const ctx = useContext(PoolCtx)
  if (!ctx) throw new Error('usePool must be used within PoolProvider')
  return ctx
}
