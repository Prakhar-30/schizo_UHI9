import { ConnectButton } from '@rainbow-me/rainbowkit'
import Button from '../ui/Button'

// Brutalist-styled wrapper around RainbowKit's connect flow.
export default function WalletButton({ size = 'sm' }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted
        const connected = ready && account && chain
        return (
          <div
            {...(!ready && { 'aria-hidden': true, style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' } })}
          >
            {(() => {
              if (!connected) {
                return (
                  <Button variant="bone" size={size} onClick={openConnectModal}>
                    Connect
                  </Button>
                )
              }
              if (chain.unsupported) {
                return (
                  <Button variant="risk" size={size} onClick={openChainModal}>
                    Wrong network
                  </Button>
                )
              }
              return (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openChainModal}
                    className="hidden sm:flex items-center gap-1.5 rounded-lg border-2 border-white/15 bg-white/5 px-2.5 py-2 font-mono text-[11px] uppercase tracking-wider text-bone/80 transition-colors hover:border-white/35"
                    title="Switch network"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${chain.id === 11155111 ? 'bg-mint' : 'bg-volt'}`} />
                    {chain.name?.replace('Reactive ', '')}
                  </button>
                  <Button variant="outline" size={size} onClick={openAccountModal}>
                    {account.displayName}
                  </Button>
                </div>
              )
            })()}
          </div>
        )
      }}
    </ConnectButton.Custom>
  )
}
