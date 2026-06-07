import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { POOLS, DEMO_POOL, getPoolById } from '../config/pools'

const PoolCtx = createContext(null)
const STORAGE_KEY = 'schizo.selectedPoolId'

export function PoolProvider({ children }) {
  const [poolId, setPoolIdState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && getPoolById(saved)) return saved
    } catch {
      /* ignore */
    }
    return DEMO_POOL.id
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, poolId)
    } catch {
      /* ignore */
    }
  }, [poolId])

  const setPoolId = (id) => {
    if (getPoolById(id)) setPoolIdState(id)
  }

  const value = useMemo(
    () => ({ pool: getPoolById(poolId) || DEMO_POOL, poolId, setPoolId, pools: POOLS }),
    [poolId],
  )
  return <PoolCtx.Provider value={value}>{children}</PoolCtx.Provider>
}

export function usePool() {
  const ctx = useContext(PoolCtx)
  if (!ctx) throw new Error('usePool must be used within PoolProvider')
  return ctx
}
