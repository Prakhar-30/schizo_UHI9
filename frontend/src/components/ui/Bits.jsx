import { useState } from 'react'
import { shortAddr, copy } from '../../lib/format'

export function Kicker({ children, className = '' }) {
  return <span className={`kicker ${className}`}>{children}</span>
}

export function Chip({ children, className = '', color = 'white' }) {
  const map = {
    white: 'border-white/20 text-bone/70',
    volt: 'border-volt/50 text-volt',
    yield: 'border-yield/50 text-yield',
    risk: 'border-risk/50 text-risk',
    mint: 'border-mint/50 text-mint',
    amber: 'border-amber/50 text-amber',
  }
  return <span className={`chip ${map[color]} ${className}`}>{children}</span>
}

export function Dot({ color = 'mint', pulse = false }) {
  const map = { mint: 'bg-mint', yield: 'bg-yield', risk: 'bg-risk', volt: 'bg-volt', amber: 'bg-amber', gray: 'bg-white/30' }
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && (
        <span className={`absolute inline-flex h-full w-full rounded-full ${map[color]} opacity-60 animate-ping`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${map[color]}`} />
    </span>
  )
}

export function Divider({ className = '' }) {
  return <div className={`h-px w-full bg-white/10 ${className}`} />
}

export function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin ${className}`}
    />
  )
}

export function SectionHead({ kicker, title, sub, right, className = '' }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {kicker && <Kicker className="mb-2 block">{kicker}</Kicker>}
        <h2 className="font-black text-2xl tracking-tight leading-none sm:text-4xl">{title}</h2>
        {sub && <p className="mt-3 max-w-xl text-sm leading-relaxed text-bone/55">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Addr({ value, href, className = '' }) {
  const [done, setDone] = useState(false)
  if (!value) return <span className="text-bone/30">—</span>
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${className}`}>
      <button
        onClick={async () => {
          if (await copy(value)) {
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          }
        }}
        className="text-bone/75 hover:text-bone transition-colors"
        title={value}
      >
        {shortAddr(value)}
      </button>
      {done ? (
        <span className="text-yield text-[10px]">copied</span>
      ) : (
        href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-bone/30 hover:text-volt transition-colors"
            title="View on explorer"
          >
            ↗
          </a>
        )
      )}
    </span>
  )
}

// FEE-T (yield) / IL-T (risk) leg badge
export function Leg({ kind, className = '' }) {
  const isFee = kind === 'fee'
  return (
    <span
      className={`chip ${isFee ? 'border-yield/60 text-yield bg-yield/5' : 'border-risk/60 text-risk bg-risk/5'} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isFee ? 'bg-yield' : 'bg-risk'}`} />
      {isFee ? 'FEE-T' : 'IL-T'}
    </span>
  )
}
