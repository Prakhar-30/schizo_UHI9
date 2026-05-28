import { useMemo, useState } from 'react'
import { Card } from './ui/Card'
import { Kicker, Chip } from './ui/Bits'
import Button from './ui/Button'
import { fmtToken, fmtBpsPct, copy } from '../lib/format'

/**
 * Share panel for a position: copy-link, tweet intent, and an inline preview
 * of the OG card rendered by /api/og?id=N.
 *
 * In Vite dev the /api route doesn't run — the preview will 404 locally and
 * show a fallback. Everything works after `vercel dev` or once deployed.
 */
export default function SharePanel({ positionId, position }) {
  const [copied, setCopied] = useState(false)
  const [imgOk, setImgOk] = useState(true)

  // Cache-buster: Telegram + X cache OG previews per exact URL for ~7 days.
  // Using the current IL mark as a version param makes the URL change whenever
  // the position state changes — forcing crawlers to re-fetch and pick up the
  // fresh OG card. Also bypasses any stale cache from earlier broken deploys.
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

  const tweetText = useMemo(() => {
    const parts = [`schizō Position #${positionId} ·`]
    if (position?.askPremium) parts.push(`${fmtToken(position.askPremium)} BETA premium`)
    if (position?.ilMarkBps !== undefined) parts.push(`IL ${fmtBpsPct(position.ilMarkBps)}`)
    parts.push('— LP fees without the impermanent loss.')
    return parts.join(' ')
  }, [positionId, position])

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

  return (
    <Card className="p-5 sm:p-6">
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

      {/* link */}
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-ink-soft/60 px-3 py-2">
        <span className="truncate font-mono text-[11px] text-bone/55">{shareUrl}</span>
        <button
          onClick={handleCopy}
          className="ml-auto shrink-0 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-bone/80 hover:border-volt hover:text-volt"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      {/* buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button href={tweetHref} variant="bone" size="sm" className="flex-1">
          Share on X →
        </Button>
        <Button href={ogUrl} variant="ghost" size="sm">
          Open card image ↗
        </Button>
      </div>

      <p className="mt-3 font-mono text-[10px] text-bone/35">
        // unfurl preview is rendered server-side per request; price + IL stay fresh.
      </p>
    </Card>
  )
}
