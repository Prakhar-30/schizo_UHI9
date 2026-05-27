import { useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { maxUint256, isAddress } from 'viem'
import { ADDR, HOOK_ABI, ERC20_ABI, SEPOLIA_CHAIN_ID, sepoliaAddr } from '../config/contracts'
import { useTx } from '../hooks/useTx'
import { useToast } from './ui/Toast'
import { fmtToken } from '../lib/format'
import { isSameAddr } from '../lib/format'
import { Card } from './ui/Card'
import { Chip, Leg, Addr, Divider } from './ui/Bits'
import { Field, Input } from './ui/Input'
import Button from './ui/Button'
import Modal from './ui/Modal'
import ILGauge from './ILGauge'

const hookBase = { address: ADDR.hook, abi: HOOK_ABI }

function HolderRow({ kind, label, holder, mine }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <Leg kind={kind} />
      <div className="flex items-center gap-2">
        {mine && <span className="font-mono text-[10px] uppercase tracking-wider text-volt">you</span>}
        <Addr value={holder} href={sepoliaAddr(holder)} />
      </div>
    </div>
  )
}

export default function PositionCard({ position, marked = true, onAction }) {
  const { id, lp, feeHolder, ilHolder, active, ilBondSold, liquidity, ilMarkBps, markValue, askPremium } = position
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID })
  const { run, pending } = useTx()
  const { toast } = useToast()
  const [transfer, setTransfer] = useState(null) // 'fee' | 'il' | null
  const [to, setTo] = useState('')

  const isFee = isSameAddr(address, feeHolder)
  const isIl = isSameAddr(address, ilHolder)
  const involved = isSameAddr(address, lp) || isFee || isIl
  const canBuy = active && !ilBondSold && askPremium > 0n && isConnected && !isIl
  const canExit = active && involved
  const refresh = () => onAction?.()

  async function handleBuy() {
    const allowance = await publicClient.readContract({
      address: ADDR.token1,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, ADDR.hook],
    })
    if (allowance < askPremium) {
      const ok = await run(
        { address: ADDR.token1, abi: ERC20_ABI, functionName: 'approve', args: [ADDR.hook, maxUint256] },
        { pendingMsg: 'Approving BETA…', successMsg: 'BETA approved' },
      )
      if (!ok) return
    }
    await run(
      { ...hookBase, functionName: 'buyILBond', args: [BigInt(id)] },
      { pendingMsg: 'Buying IL-T…', successMsg: `IL-T of position #${id} acquired`, onSuccess: refresh },
    )
  }

  async function handleExit() {
    await run(
      { ...hookBase, functionName: 'exitPosition', args: [BigInt(id)] },
      { pendingMsg: 'Exiting position…', successMsg: `Position #${id} exited`, onSuccess: refresh },
    )
  }

  async function handleTransfer() {
    if (!isAddress(to)) {
      toast({ variant: 'error', title: 'Invalid address' })
      return
    }
    const fn = transfer === 'fee' ? 'transferFeeToken' : 'transferILToken'
    const ok = await run(
      { ...hookBase, functionName: fn, args: [BigInt(id), to] },
      { pendingMsg: 'Transferring…', successMsg: `${transfer === 'fee' ? 'FEE-T' : 'IL-T'} transferred`, onSuccess: refresh },
    )
    if (ok) {
      setTransfer(null)
      setTo('')
    }
  }

  return (
    <Card className="flex flex-col p-5">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-black text-xl">#{id}</span>
          {active ? (
            <Chip color="mint">
              <span className="h-1.5 w-1.5 rounded-full bg-mint" /> active
            </Chip>
          ) : (
            <Chip color="white">exited</Chip>
          )}
        </div>
        <Chip color={ilBondSold ? 'risk' : 'amber'}>{ilBondSold ? 'IL-T sold' : 'IL-T open'}</Chip>
      </div>

      {/* il gauge */}
      <div className="mt-4">
        <ILGauge ilMarkBps={ilMarkBps} marked={marked} />
      </div>

      {/* numbers */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
          <p className="kicker">Liquidity</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums">{fmtToken(liquidity)}</p>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
          <p className="kicker">Premium</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-yield">{fmtToken(askPremium)} BETA</p>
        </div>
      </div>

      {/* holders */}
      <div className="mt-4">
        <HolderRow kind="fee" holder={feeHolder} mine={isFee} />
        <Divider />
        <HolderRow kind="il" holder={ilHolder} mine={isIl} />
      </div>

      {/* actions */}
      <div className="mt-auto pt-5">
        {canBuy && (
          <Button variant="risk" size="md" className="w-full" loading={pending} onClick={handleBuy}>
            Buy IL-T · {fmtToken(askPremium)} BETA
          </Button>
        )}

        {involved && (
          <div className="mt-2 flex flex-wrap gap-2">
            {isFee && active && (
              <Button variant="ghost" size="sm" onClick={() => setTransfer('fee')}>
                Transfer FEE-T
              </Button>
            )}
            {isIl && active && (
              <Button variant="ghost" size="sm" onClick={() => setTransfer('il')}>
                Transfer IL-T
              </Button>
            )}
            {canExit && (
              <Button variant="outline" size="sm" loading={pending} onClick={handleExit}>
                Exit
              </Button>
            )}
          </div>
        )}

        {!isConnected && !canBuy && (
          <p className="text-center font-mono text-[11px] text-bone/30">connect to interact</p>
        )}
      </div>

      <Modal
        open={!!transfer}
        onClose={() => setTransfer(null)}
        title={`Transfer ${transfer === 'fee' ? 'FEE-T' : 'IL-T'} · #${id}`}
      >
        <Field label="Recipient address" hint="The new holder of this leg. This is irreversible.">
          <Input placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setTransfer(null)}>
            Cancel
          </Button>
          <Button
            variant={transfer === 'fee' ? 'yield' : 'risk'}
            className="flex-1"
            loading={pending}
            onClick={handleTransfer}
          >
            Transfer
          </Button>
        </div>
      </Modal>
    </Card>
  )
}
