import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import Logo from './Logo'
import WalletButton from './WalletButton'

const LINKS = [
  { to: '/', label: 'Home', end: true, tip: 'The pitch in ten seconds — fees without the loss' },
  { to: '/create', label: 'Create', tip: 'Mint an IL-bond: split your LP into a fee leg + a risk leg' },
  { to: '/hunt', label: 'Hunt', tip: 'Browse live bonds for sale and buy the IL risk leg' },
  { to: '/markets', label: 'Markets', tip: 'Every position, marked to market in real time' },
  { to: '/leaders', label: 'Leaders', tip: 'Top fee earners, hunters & risk holders' },
  { to: '/dashboard', label: 'Dashboard', tip: 'Your positions, live IL marks & P&L' },
  { to: '/about', label: 'About', tip: 'How the hook + Reactive Network work under the hood' },
]

function Item({ to, label, end, tip, onClick }) {
  return (
    <div className="group relative">
      <NavLink
        to={to}
        end={end}
        onClick={onClick}
        className={({ isActive }) =>
          `relative block font-mono text-[13px] uppercase tracking-wider px-3 py-2 rounded-md transition-colors ${
            isActive ? 'text-ink bg-bone' : 'text-bone/55 hover:text-bone hover:bg-white/5'
          }`
        }
      >
        {label}
      </NavLink>
      {tip && (
        <div
          className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-max max-w-[210px] -translate-x-1/2 translate-y-1 rounded-md border border-volt/30 bg-ink/95 px-2.5 py-1.5 text-center font-mono text-[10px] normal-case leading-snug tracking-normal text-bone/70 opacity-0 shadow-glow backdrop-blur-xl transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100"
        >
          <span
            className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-volt/30 bg-ink/95"
            aria-hidden
          />
          {tip}
        </div>
      )}
    </div>
  )
}

function MobileItem({ to, label, end, tip, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `block rounded-md px-3 py-2 transition-colors ${
          isActive ? 'bg-bone text-ink' : 'text-bone/70 hover:bg-white/5 hover:text-bone'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className="font-mono text-[13px] uppercase tracking-wider">{label}</span>
          {tip && (
            <span
              className={`mt-0.5 block font-mono text-[10px] normal-case leading-snug tracking-normal ${
                isActive ? 'text-ink/55' : 'text-bone/40'
              }`}
            >
              {tip}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export default function Navbar() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-50">
      <div className="glass border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
          <Logo />

          <nav className="hidden items-center gap-3 lg:flex">
            {LINKS.map((l) => (
              <Item key={l.to} {...l} />
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <WalletButton />
            <button
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-white/15 text-bone lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="menu"
              aria-expanded={open}
            >
              <div className="space-y-1">
                <span className={`block h-0.5 w-4 bg-bone transition-transform ${open ? 'translate-y-1.5 rotate-45' : ''}`} />
                <span className={`block h-0.5 w-4 bg-bone transition-opacity ${open ? 'opacity-0' : ''}`} />
                <span className={`block h-0.5 w-4 bg-bone transition-transform ${open ? '-translate-y-1.5 -rotate-45' : ''}`} />
              </div>
            </button>
          </div>
        </div>

        {open && (
          <nav className="flex flex-col gap-1 border-t border-white/10 bg-ink/95 px-4 py-3 backdrop-blur-xl lg:hidden">
            {LINKS.map((l) => (
              <MobileItem key={l.to} {...l} onClick={() => setOpen(false)} />
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
