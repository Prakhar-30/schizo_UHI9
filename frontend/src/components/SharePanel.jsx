import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { Card } from './ui/Card'
import { Kicker } from './ui/Bits'
import Button from './ui/Button'
import { fmtToken, copy, isSameAddr } from '../lib/format'

/**
 * Share panel for a position: copy-link, tweet intent, and a thumbnail of the
 * OG card rendered by /api/og?id=N.
 *
 * Pass `embedded` when rendering inside a Card you've already laid out (e.g.,
 * the Dashboard's "Cast your bonds" section) so we don't double up on chrome.
 */
export default function SharePanel({ positionId, position, embedded = false }) {
  const { address } = useAccount()
  const [copied, setCopied] = useState(false)
  const [imgOk, setImgOk] = useState(true)

  const isLp = isSameAddr(address, position?.lp)
  const isFee = isSameAddr(address, position?.feeHolder)
  const isIl = isSameAddr(address, position?.ilHolder)

  // Cache-buster: Telegram + X cache OG previews per exact URL for ~7 days.
  // Using the current IL mark as a version param makes the URL change whenever
  // the position state changes — forcing crawlers to re-fetch the fresh card.
  const cacheBuster = useMemo(() => {
    const live = position?.liveIlBps ?? position?.ilMarkBps
    const mark = live !== undefined && live !== null ? Math.abs(Number(live)) : 0
    return `${positionId}-${mark}`
  }, [positionId, position?.liveIlBps, position?.ilMarkBps])

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/positions/${positionId}?v=${cacheBuster}`
  }, [positionId, cacheBuster])

  // Include the same cache-buster as the share URL so the in-app preview and the
  // crawler's og:image both re-fetch whenever the position's state changes.
  const ogUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/api/og?id=${positionId}&v=${cacheBuster}`
  }, [positionId, cacheBuster])

  const tweetText = useMemo(
    () => composeTweet({ positionId, position, isLp, isFee, isIl }),
    [positionId, position, isLp, isFee, isIl],
  )

  const tweetHref = useMemo(() => {
    const text = encodeURIComponent(tweetText)
    const url = encodeURIComponent(shareUrl)
    return `https://twitter.com/intent/tweet?text=${text}&url=${url}`
  }, [tweetText, shareUrl])

  async function handleCopy() {
    const ok = await copy(shareUrl)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const inner = (
    <div className="space-y-4">
      {/* compact card-style preview, centered, capped width */}
      <a
        href={ogUrl}
        target="_blank"
        rel="noreferrer"
        className="mx-auto block w-full max-w-sm overflow-hidden rounded-lg border border-white/10 bg-ink-soft/50 transition-opacity hover:opacity-90"
        title="Open the OG card image"
      >
        {imgOk ? (
          <img
            src={ogUrl}
            alt={`Position #${positionId} share card`}
            className="block aspect-[1200/630] w-full"
            loading="lazy"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="grid aspect-[1200/630] w-full place-items-center p-3 text-center">
            <p className="font-mono text-[10px] text-bone/40">og preview · deploy to render</p>
          </div>
        )}
      </a>

      {/* action row: url pill + primary CTA */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-ink-soft/60 px-3 py-2">
          <span className="truncate font-mono text-[11px] text-bone/55">{shareUrl}</span>
          <button
            onClick={handleCopy}
            className="ml-auto shrink-0 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-bone/80 hover:border-volt hover:text-volt"
          >
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
        <Button href={tweetHref} variant="bone" size="md" className="shrink-0 sm:px-6">
          Post on X →
        </Button>
      </div>
    </div>
  )

  if (embedded) return inner
  return (
    <Card className="p-5 sm:p-6">
      <Kicker>Share</Kicker>
      <div className="mt-3">{inner}</div>
    </Card>
  )
}

// ── tweet copy ────────────────────────────────────────────────────────────
// Punchy variants chosen by user-role. Tight line spacing (no blank lines),
// no em-dashes, subtle "↓" hook pointing at the unfurled card / URL.
function composeTweet({ positionId, position, isLp, isFee, isIl }) {
  // Prefer the live (pool-price) IL; fall back to the last on-chain RSC mark.
  const ilBps = position?.liveIlBps ?? position?.ilMarkBps
  const hasMark = ilBps !== undefined && ilBps !== null && Number(ilBps) !== 0
  const ilSigned = hasMark
    ? `${Number(ilBps) > 0 ? '+' : ''}${(Number(ilBps) / 100).toFixed(2)}%`
    : 'pending'
  const ilAbs = hasMark ? `${Math.abs(Number(ilBps) / 100).toFixed(2)}%` : null
  // Premium is denominated in the position's own pool token, with its decimals.
  const premSym = position?.premiumSym || 'tokens'
  const premDec = position?.premiumDec ?? 18
  const premium = position?.askPremium ? `${fmtToken(position.askPremium, premDec)} ${premSym}` : '—'
  const pair = position?.pool?.label ? ` (${position.pool.label})` : ''
  const sold = position?.ilBondSold

  // FEE-T holder of a sold bond — the "I farm yield, someone else eats IL" flex.
  if (sold && (isLp || isFee)) {
    return [
      `sold the impermanent loss on my ${position?.pool?.label || 'LP'} position for ${premium} 🫡`,
      ilAbs
        ? `someone else holds the -${ilAbs} now. i just collect fees.`
        : `someone else holds the price risk now. i just collect fees.`,
      `position #${positionId}${pair} · schizō · @0xreactive marks live every swap`,
      `yours? ↓`,
    ].join('\n')
  }

  // IL-T holder — the degen taking the bet.
  if (isIl) {
    return [
      `took the IL leg on position #${positionId}${pair} for ${premium} 📉`,
      `current mark: ${ilSigned} (live, posted by @0xreactive)`,
      `if it recovers i print. if not, 😅`,
      `schizō · UHI9 ↓`,
    ].join('\n')
  }

  // LP advertising an unsold bond.
  if (!sold && (isLp || isFee)) {
    return [
      `my ${position?.pool?.label || 'LP'} position is up for grabs 👀`,
      `${premium} buys the impermanent-loss leg.`,
      `i keep the fees, you take the price risk.`,
      `position #${positionId}${pair} · schizō · @0xreactive marks live ↓`,
    ].join('\n')
  }

  // Default: "look at this thing" promotional.
  return [
    `impermanent loss is tradeable now 🤔`,
    `position #${positionId}${pair} on schizō`,
    `↳ ${premium} premium`,
    `↳ IL mark: ${ilSigned} (live, by @0xreactive)`,
    `LP fees without the loss · UHI9 ↓`,
  ].join('\n')
}
