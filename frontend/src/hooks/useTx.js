import { useState, useCallback } from 'react'
import { useWriteContract, usePublicClient } from 'wagmi'
import { useToast } from '../components/ui/Toast'
import { SEPOLIA_CHAIN_ID, sepoliaTx } from '../config/contracts'

export function parseTxError(e) {
  const raw = e?.shortMessage || e?.details || e?.message || 'Unknown error'
  if (/user rejected|denied|rejected the request/i.test(raw)) return 'rejected'
  // keep it short for the toast
  return raw.split('\n')[0].slice(0, 140)
}

/**
 * Wraps writeContract → wait for receipt → toast lifecycle.
 * run(request, { pendingMsg, successMsg, onSuccess })
 */
export function useTx() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID })
  const { toast, dismiss } = useToast()
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async (request, { pendingMsg = 'Confirming…', successMsg = 'Confirmed', onSuccess } = {}) => {
      let toastId
      try {
        setPending(true)
        const hash = await writeContractAsync({ chainId: SEPOLIA_CHAIN_ID, ...request })
        toastId = toast({
          variant: 'pending',
          title: pendingMsg,
          desc: 'Waiting for inclusion…',
          duration: 0,
          link: { href: sepoliaTx(hash), label: 'View tx' },
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        dismiss(toastId)
        if (receipt.status === 'success') {
          toast({ variant: 'success', title: successMsg, link: { href: sepoliaTx(hash), label: 'View tx' } })
          await onSuccess?.(receipt)
          return receipt
        }
        toast({ variant: 'error', title: 'Transaction reverted', link: { href: sepoliaTx(hash), label: 'View tx' } })
        return null
      } catch (e) {
        if (toastId) dismiss(toastId)
        const msg = parseTxError(e)
        if (msg !== 'rejected') toast({ variant: 'error', title: 'Transaction failed', desc: msg })
        return null
      } finally {
        setPending(false)
      }
    },
    [writeContractAsync, publicClient, toast, dismiss],
  )

  return { run, pending }
}
