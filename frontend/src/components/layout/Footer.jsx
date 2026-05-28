import { Link } from 'react-router-dom'
import { Mark } from './Logo'
import { ADDR, sepoliaAddr, reactscanAddr } from '../../config/contracts'
import { Addr, Divider } from '../ui/Bits'

export default function Footer() {
  return (
    <footer className="relative mt-16 border-t-2 border-white/10 sm:mt-24">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-8 sm:gap-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Mark size={30} />
              <span className="font-black text-xl tracking-tight">
                schiz<span className="text-volt">ō</span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-bone/50">
              Unbundle any Uniswap v4 LP into a yield leg and a risk leg. Impermanent loss,
              marked to market every swap by Reactive Network.
            </p>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-bone/35">
              Built for UHI9 · Theme: Impermanent Loss
            </p>
          </div>

          <div>
            <p className="kicker mb-4">Platform</p>
            <ul className="space-y-2.5 text-sm">
              <li><Link className="link" to="/create">Create a bond</Link></li>
              <li><Link className="link" to="/markets">Markets</Link></li>
              <li><Link className="link" to="/dashboard">Dashboard</Link></li>
              <li><Link className="link" to="/about">How it works</Link></li>
            </ul>
          </div>

          <div>
            <p className="kicker mb-4">Network</p>
            <ul className="space-y-2.5 text-sm text-bone/60">
              <li>Ethereum Sepolia</li>
              <li>Reactive Lasna</li>
              <li className="pt-1">
                <a className="link" href="https://reactive.network" target="_blank" rel="noreferrer">
                  reactive.network ↗
                </a>
              </li>
              <li>
                <a className="link" href="https://docs.uniswap.org/contracts/v4/overview" target="_blank" rel="noreferrer">
                  Uniswap v4 ↗
                </a>
              </li>
            </ul>
          </div>

          <div className="min-w-0">
            <p className="kicker mb-4">Contracts</p>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-bone/45">Hook</span>
                <Addr value={ADDR.hook} href={sepoliaAddr(ADDR.hook)} />
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-bone/45">Reactive</span>
                <Addr value={ADDR.reactive} href={reactscanAddr(ADDR.reactive)} />
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-bone/45">ALPHA</span>
                <Addr value={ADDR.token0} href={sepoliaAddr(ADDR.token0)} />
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-bone/45">BETA</span>
                <Addr value={ADDR.token1} href={sepoliaAddr(ADDR.token1)} />
              </li>
            </ul>
          </div>
        </div>

        <Divider className="my-8" />
        <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
          <p className="font-mono text-[11px] uppercase tracking-wider text-bone/35">
            © {new Date().getFullYear()} schizō — testnet only, not financial advice
          </p>
          <p className="font-mono text-[11px] uppercase tracking-wider text-bone/35">
            yield <span className="text-yield">/</span> risk <span className="text-risk">/</span> split
          </p>
        </div>
      </div>
    </footer>
  )
}
