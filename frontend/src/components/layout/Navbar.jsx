import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import Logo from './Logo'
import WalletButton from './WalletButton'

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/create', label: 'Create' },
  { to: '/hunt', label: 'Hunt' },
  { to: '/markets', label: 'Markets' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/about', label: 'About' },
]

function Item({ to, label, end, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `relative font-mono text-[13px] uppercase tracking-wider px-3 py-2 rounded-md transition-colors ${
          isActive ? 'text-ink bg-bone' : 'text-bone/55 hover:text-bone hover:bg-white/5'
        }`
      }
    >
      {label}
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

          <nav className="hidden items-center gap-4 md:flex">
            {LINKS.map((l) => (
              <Item key={l.to} {...l} />
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <WalletButton />
            <button
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-white/15 text-bone md:hidden"
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
          <nav className="flex flex-col gap-1 border-t border-white/10 bg-ink/95 px-4 py-3 backdrop-blur-xl md:hidden">
            {LINKS.map((l) => (
              <Item key={l.to} {...l} onClick={() => setOpen(false)} />
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
