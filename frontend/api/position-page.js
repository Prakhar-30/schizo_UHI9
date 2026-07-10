// Edge function that serves /positions/:id - fetches the SPA shell from
// /index.html and rewrites the <head> with per-position OG / Twitter Card
// meta tags so X / Telegram / Discord crawlers (which DON'T run JS) can
// unfurl a proper card.
//
// Routed via vercel.json: `/positions/:id(\d+)` → `/api/position-page?id=:id`.

export const config = { runtime: 'edge' }

export default async function handler(req) {
  const url = new URL(req.url)
  const id = (url.searchParams.get('id') || '').replace(/[^0-9]/g, '')
  // Cache-buster forwarded from the share URL (?v=<id>-<mark>). Threaded into the
  // og:image URL so X / Telegram re-fetch the card when the position changes.
  const v = (url.searchParams.get('v') || '').replace(/[^0-9a-zA-Z._-]/g, '')
  // Which chain's deployment to render the card for (defaults Sepolia in og.js).
  const chain = (url.searchParams.get('chain') || '').replace(/[^0-9]/g, '')
  const origin = url.origin

  // Pull the static SPA shell. The internal fetch hits the static-file
  // serving layer (no rewrite recursion - /index.html is on disk).
  let html
  try {
    const res = await fetch(origin + '/index.html', {
      headers: { 'x-og-shell': '1' },
    })
    if (!res.ok) return new Response('shell not found', { status: 404 })
    html = await res.text()
  } catch (e) {
    return new Response('shell fetch failed: ' + (e?.message || ''), { status: 502 })
  }

  // No id → return the SPA verbatim so React Router can render the NotFound.
  if (!id) {
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  const ogImage = origin + '/api/og?id=' + id + (v ? '&v=' + v : '') + (chain ? '&chain=' + chain : '')
  const title = 'Position #' + id + ' · schizō'
  const desc =
    'IL bond on schizō. Live impermanent-loss mark derived on-chain by the hook on every swap.'
  const canonical = origin + '/positions/' + id

  const meta = `
    <title>${title}</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:site_name" content="schizō" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${ogImage}" />
  `

  // Strip the default <title>, then append our tags before </head>.
  const stripped = html.replace(/<title>[^<]*<\/title>/i, '')
  const rewritten = stripped.replace('</head>', meta + '</head>')

  return new Response(rewritten, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  })
}
