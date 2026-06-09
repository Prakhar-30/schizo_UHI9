import { useState } from 'react'
import { useAccount } from 'wagmi'
import { parseUnits } from 'viem'
import { ERC20_ABI } from '../config/contracts'
import { usePool } from '../context/PoolContext'
import { useNetwork } from '../context/NetworkContext'
import { useTokenInfo } from '../hooks/reads'
import { useTx } from '../hooks/useTx'
import { fmtToken } from '../lib/format'
import { Card } from './ui/Card'
import { Kicker, Chip, Divider } from './ui/Bits'
import Button from './ui/Button'
import PoolSelector from './PoolSelector'

function BalanceLine({ sym, color, value, decimals, mintable, onMint, minting }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <span className="font-mono text-sm font-bold">{sym}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm tabular-nums text-bone/70">{fmtToken(value, decimals)}</span>
        {mintable ? (
          <Button size="sm" variant="ghost" loading={minting} onClick={onMint}>
            +1,000
          </Button>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wider text-bone/30">external faucet</span>
        )}
      </div>
    </div>
  )
}

/**
 * Test-token faucet for the selected pool's pair. `showSelector` lets the user
 * switch which pool's tokens to mint; `banner` shows the demo/beta disclaimer.
 */
export default function Faucet({ showSelector = false, banner = false }) {
  const { pool } = usePool()
  const net = useNetwork()
  const { address, isConnected } = useAccount()
  const { bal0, bal1, refetch } = useTokenInfo(address, pool.token0, pool.token1)
  const { run } = useTx()
  const [minting, setMinting] = useState(null)

  const tok0 = net.getToken(pool.token0)
  const tok1 = net.getToken(pool.token1)
  const anyMintable = tok0.mintable || tok1.mintable

  async function mint(token, sym, decimals) {
    setMinting(sym)
    await run(
      { address: token, abi: ERC20_ABI, functionName: 'mint', args: [address, parseUnits('1000', decimals)] },
      { pendingMsg: `Minting ${sym}…`, successMsg: `+1,000 ${sym} minted`, onSuccess: refetch },
    )
    setMinting(null)
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <Kicker>Faucet · your balances</Kicker>
        <Chip color={anyMintable ? 'mint' : 'white'}>{anyMintable ? 'free · testnet' : 'real tokens'}</Chip>
      </div>

      {showSelector && <PoolSelector className="mt-3" label="Token pair" />}

      {banner && (
        <div className="mt-3 rounded-lg border border-amber/30 bg-amber/[0.06] px-3 py-2 font-mono text-[11px] leading-relaxed text-amber/90">
          ⚠ Test / demo / beta only — mints free test tokens for the <b>{pool.label}</b> pool on {net.name}. These are not
          real assets and have no value.
        </div>
      )}

      <div className="mt-3">
        {isConnected ? (
          <>
            <BalanceLine
              sym={tok0.symbol}
              color="bg-yield"
              value={bal0}
              decimals={pool.dec0}
              mintable={tok0.mintable}
              minting={minting === tok0.symbol}
              onMint={() => mint(pool.token0, tok0.symbol, pool.dec0)}
            />
            <Divider />
            <BalanceLine
              sym={tok1.symbol}
              color="bg-risk"
              value={bal1}
              decimals={pool.dec1}
              mintable={tok1.mintable}
              minting={minting === tok1.symbol}
              onMint={() => mint(pool.token1, tok1.symbol, pool.dec1)}
            />
          </>
        ) : (
          <p className="py-4 text-center font-mono text-sm text-bone/30">connect to see balances</p>
        )}
      </div>
    </Card>
  )
}
