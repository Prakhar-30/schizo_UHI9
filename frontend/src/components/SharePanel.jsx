import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { Card } from './ui/Card'
import { Kicker, Chip } from './ui/Bits'
import Button from './ui/Button'
import { fmtToken, copy, isSameAddr } from '../lib/format'

/**
 * Share panel for a position: copy-link, tweet intent, and an inline preview
 * of the OG card rendered by /api/og?id=N.
 *
 * Pass `embedded` when rendering inside a Modal so the outer Card wrapper
 * is skipped (Modal already provides the chrome).
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
    const mark = position?.ilMarkBps !== undefined ? Math.abs(Number(position.ilMarkBps)) : 0
    return `${positionId}-${mark}`
  }, [positionId, position?.ilMarkBps])

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/positions/${positionId}?v=${cacheBuster}`
  }, [positionId, cacheBuster])

  const ogUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/api/og?id=${positionId}`
  }, [positionId])

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
    <>
      <div className="flex items-center justify-between">
        <Kicker>Share</Kicker>
        <Chip color="volt">og-image enabled</Chip>
      </div>

      {/* preview */}
      <a
        href={ogUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block overflow-hidden rounded-xl border border-white/10 bg-ink-soft/50"
        title="Open the OG card image"
      >
        {imgOk ? (
          <img
            src={ogUrl}
            alt={`Position #${positionId} share card`}
            className="block aspect-[1200/630] w-full object-cover"
            loading="lazy"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="aspect-[1200/630] w-full p-6 grid place-items-center text-center">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-bone/40">og preview</p>
              <p className="mt-2 text-sm text-bone/55">
                Run <span className="font-mono text-volt">vercel dev</span> or deploy to see the live card.
              </p>
            </div>
          </div>
        )}
      </a>

      {/* tweet preview */}
      <div className="mt-4 rounded-lg border border-white/10 bg-ink-soft/60 p-3">
        <div className="mb-1 flex items-center justify-between">
          <Kicker>Tweet text</Kicker>
          <span className="font-mono text-[10px] uppercase tracking-wider text-bone/30">
            edit on X before posting
          </span>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-bone/80">
          {tweetText}
        </pre>
      </div>

      {/* link */}
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-ink-soft/60 px-3 py-2">
        <span className="truncate font-mono text-[11px] text-bone/55">{shareUrl}</span>
        <button
          onClick={handleCopy}
          className="ml-auto shrink-0 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-bone/80 hover:border-volt hover:text-volt"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      {/* buttons */}
      <div className="mt-3">
        <Button href={tweetHref} variant="bone" size="md" className="w-full">
          Post on X →
        </Button>
      </div>

      <p className="mt-3 font-mono text-[10px] text-bone/35">
        // url has a built-in cache-buster (?v=id-mark) so X & Telegram always unfurl the latest card.
      </p>
    </>
  )

  if (embedded) return <div>{inner}</div>
  return <Card className="p-5 sm:p-6">{inner}</Card>
}

// ── tweet copy ────────────────────────────────────────────────────────────
// Picks a punchy variant based on the user's relationship to the position.
function composeTweet({ positionId, position, isLp, isFee, isIl }) {
  const ilBps = position?.ilMarkBps
  const hasMark = ilBps !== undefined && ilBps !== null && Number(ilBps) !== 0
  const ilSigned = hasMark
    ? `${Number(ilBps) > 0 ? '+' : ''}${(Number(ilBps) / 100).toFixed(2)}%`
    : 'pending'
  const ilAbs = hasMark ? `${Math.abs(Number(ilBps) / 100).toFixed(2)}%` : null
  const premium = position?.askPremium ? `${fmtToken(position.askPremium)} BETA` : '—'
  const sold = position?.ilBondSold

  // Holding the FEE leg of a sold bond — the "I'm farming yield with no IL" flex.
  if (sold && (isLp || isFee)) {
    return [
      `sold the impermanent loss on my LP for ${premium} 🫡`,
      ``,
      ilAbs
        ? `someone else is eating the -${ilAbs} now — i'm just collecting fees`
        : `someone else holds the price risk now — i just collect fees`,
      ``,
      `position #${positionId} · schizō · marked live by @0xreactive every swap`,
    ].join('\n')
  }

  // Holding the IL leg — the degen risk-taker post.
  if (isIl) {
    return [
      `took the IL leg on position #${positionId} for ${premium} 📉`,
      ``,
      `current mark: ${ilSigned} (live, posted by @0xreactive)`,
      ``,
      `if it recovers i print. if it doesn't 😅`,
      `schizō · UHI9 ↓`,
    ].join('\n')
  }

  // Open bond, you're the LP advertising it.
  if (!sold && (isLp || isFee)) {
    return [
      `my LP position is up for grabs 👀`,
      ``,
      `${premium} buys you the impermanent-loss leg.`,
      `i keep the fees, you take the price risk.`,
      ``,
      `position #${positionId} · schizō · marked live by @0xreactive`,
    ].join('\n')
  }

  // Default: promotional / "look at this cool thing"
  return [
    `impermanent loss is tradeable now 🤔`,
    ``,
    `position #${positionId} on schizō`,
    `↳ ${premium} premium`,
    `↳ IL mark: ${ilSigned} (live)`,
    `↳ posted by @0xreactive every swap`,
    ``,
    `LP fees without the loss · UHI9 ↓`,
  ].join('\n')
}
