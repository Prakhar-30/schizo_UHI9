import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { HashRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import '@rainbow-me/rainbowkit/styles.css'
import './index.css'
import { config } from './config/wagmi'
import { ToastProvider } from './components/ui/Toast'
import { NetworkProvider } from './context/NetworkContext'
import { PoolProvider } from './context/PoolContext'
import App from './App'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

// HashRouter puts the route in the fragment, which analytics would collapse to
// a single "/" page. Rewrite "#/markets?x=1" into a real "/markets" pathname so
// the dashboard reports per-page views.
function unhashRoute(event) {
  try {
    const u = new URL(event.url)
    if (u.hash.startsWith('#/')) {
      u.pathname = u.hash.slice(1).split('?')[0]
      u.hash = ''
      u.search = ''
      return { ...event, url: u.toString() }
    }
  } catch {
    /* fall through with the original event */
  }
  return event
}

const rkTheme = darkTheme({
  accentColor: '#7c5cff',
  accentColorForeground: '#ffffff',
  borderRadius: 'small',
  fontStack: 'system',
  overlayBlur: 'small',
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rkTheme} modalSize="compact">
          <ToastProvider>
            <NetworkProvider>
              <PoolProvider>
                {/* HashRouter → deep-link reloads never 404 on static hosts */}
                <HashRouter>
                  <App />
                  <Analytics beforeSend={unhashRoute} />
                </HashRouter>
              </PoolProvider>
            </NetworkProvider>
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
