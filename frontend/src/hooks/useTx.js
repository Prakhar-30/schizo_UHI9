import { useState, useCallback } from 'react'
import { useWriteContract, usePublicClient, useAccount } from 'wagmi'
import { encodeFunctionData, toHex } from 'viem'
import { useToast } from '../components/ui/Toast'
import { useNetwork } from '../context/NetworkContext'

// ─────────────────────────────────────────────────────────────────────────────
//  Unichain Sepolia gas-estimation workaround
//  Its RPC nodes reject the *unbounded* eth_estimateGas that wallets/viem send
//  by default ("-32000: intrinsic gas too high"), so every contract write shows
//  "Network fee: Unavailable" and can't be submitted — even though the tx is
//  perfectly valid on-chain. The node estimates fine when given an explicit gas
//  *cap*, so for this chain we estimate ourselves (capped + buffered) and hand
//  the result to the wallet, which then skips its own broken estimation.
//  Scoped to chainId 1301 only — every other chain is left completely untouched.
// ─────────────────────────────────────────────────────────────────────────────
const GAS_ESTIMATE_CHAINS = new Set([1301]) // Unichain Sepolia
const GAS_CAP = 2_000_000n // upper bound the node accepts; >> any op (~600k), << the ~24M bad range
const GAS_BUFFER_PCT = 125n // +25% safety margin over the estimate

export function parseTxError(e) {
  const raw = e?.shortMessage || e?.details || e?.message || 'Unknown error'
  if (/user rejected|denied|rejected the request/i.test(raw)) return 'rejected'
  // keep it short for the toast
  return raw.split('\n')[0].slice(0, 140)
}

// Capped, buffered gas estimate for chains whose default estimation is broken.
// On a (genuine) revert the capped estimate also throws, so we re-run the call
// via eth_call to surface the real revert reason before giving up.
async function estimateGasCapped(publicClient, from, request) {
  const data = encodeFunctionData({
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
  })
  const tx = { from, to: request.address, data, gas: toHex(GAS_CAP) }
  if (request.value != null) tx.value = toHex(request.value)
  try {
    const hex = await publicClient.request({ method: 'eth_estimateGas', params: [tx] })
    return (BigInt(hex) * GAS_BUFFER_PCT) / 100n
  } catch (estErr) {
    // Good cap + failed estimate ⇒ the call reverts. Surface the clean reason.
    await publicClient.call({ account: from, to: request.address, data, value: request.value })
    throw estErr // call unexpectedly succeeded; bubble the original error up
  }
}

/**
 * Wraps writeContract → wait for receipt → toast lifecycle.
 * run(request, { pendingMsg, successMsg, onSuccess })
 */
export function useTx() {
  const net = useNetwork()
  const { writeContractAsync } = useWriteContract()
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: net.chainId })
  const { toast, dismiss } = useToast()
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async (request, { pendingMsg = 'Confirming…', successMsg = 'Confirmed', onSuccess } = {}) => {
      let toastId
      try {
        setPending(true)
        const req = { chainId: net.chainId, ...request }
        // On chains with broken default gas estimation (Unichain Sepolia), supply
        // an explicit gas limit so the wallet doesn't run the failing estimate.
        if (GAS_ESTIMATE_CHAINS.has(net.chainId) && req.gas == null && address && publicClient) {
          req.gas = await estimateGasCapped(publicClient, address, request)
        }
        const hash = await writeContractAsync(req)
        toastId = toast({
          variant: 'pending',
          title: pendingMsg,
          desc: 'Waiting for inclusion…',
          duration: 0,
          link: { href: net.txUrl(hash), label: 'View tx' },
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        dismiss(toastId)
        if (receipt.status === 'success') {
          toast({ variant: 'success', title: successMsg, link: { href: net.txUrl(hash), label: 'View tx' } })
          await onSuccess?.(receipt)
          return receipt
        }
        toast({ variant: 'error', title: 'Transaction reverted', link: { href: net.txUrl(hash), label: 'View tx' } })
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
    [writeContractAsync, publicClient, toast, dismiss, net, address],
  )

  return { run, pending }
}
