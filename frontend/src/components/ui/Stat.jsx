import { Kicker } from './Bits'

const ACCENT = {
  bone: 'text-bone',
  volt: 'text-volt',
  yield: 'text-yield',
  risk: 'text-risk',
  mint: 'text-mint',
  amber: 'text-amber',
}

export default function Stat({ label, value, sub, accent = 'bone', icon, loading = false, className = '' }) {
  return (
    <div className={`card p-4 sm:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <Kicker className="truncate">{label}</Kicker>
        {icon && <span className="text-bone/30">{icon}</span>}
      </div>
      <div className={`mt-3 break-all font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl ${ACCENT[accent]}`}>
        {loading ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-white/10" /> : value}
      </div>
      {sub && <p className="mt-2 font-mono text-[11px] text-bone/45">{sub}</p>}
    </div>
  )
}
