import { usePool } from '../context/PoolContext'

// Compact pool picker. Drives the active pool for Swap / Create.
export default function PoolSelector({ label = 'Pool', className = '' }) {
  const { pool, poolId, setPoolId, pools } = usePool()
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="kicker">{label}</span>
        {pool.demo && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-mint">demo · faucet</span>
        )}
      </div>
      <select
        value={poolId}
        onChange={(e) => setPoolId(e.target.value)}
        className="w-full min-w-0 max-w-full rounded-lg border-2 border-white/15 bg-ink-card px-3 py-2.5 font-mono text-sm font-bold text-bone focus:border-volt focus:outline-none"
      >
        {pools.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.demo ? '  (demo)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
