import { next } from '@vercel/edge'

// Intercept /positions/:id requests so social crawlers (Twitter, Telegram,
// Discord, iMessage) see proper og:image / twitter:image meta tags. The SPA
// would normally only get them after JS executes — crawlers don't run JS.
export default async function middleware(request) {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/positions\/(\d+)\/?$/)
  if (!match) return next()

  const id = match[1]
  const origin = url.origin

  // Continue routing to fetch the static index.html, then rewrite <head>.
  const res = await next()
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('text/html')) return res

  const html = await res.text()

  const ogImage = `${origin}/api/og?id=${id}`
  const title = `Position #${id} · schizō`
  const desc = `IL bond on schizō. Live impermanent-loss mark posted by the Reactive Network on every swap.`

  const meta = `
    <title>${title}</title>
    <meta name="description" content="${desc}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${origin}/positions/${id}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${ogImage}" />
  `

  // Strip the default <title> if present, then append our tags.
  const stripped = html.replace(/<title>[^<]*<\/title>/i, '')
  const rewritten = stripped.replace('</head>', `${meta}</head>`)

  return new Response(rewritten, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=60',
    },
  })
}

export const config = {
  matcher: '/positions/:path*',
}
