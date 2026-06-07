import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { HashRouter } from 'react-router-dom'
import '@rainbow-me/rainbowkit/styles.css'
import './index.css'
import { config } from './config/wagmi'
import { ToastProvider } from './components/ui/Toast'
import { PoolProvider } from './context/PoolContext'
import App from './App'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

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
            <PoolProvider>
              {/* HashRouter → deep-link reloads never 404 on static hosts */}
              <HashRouter>
                <App />
              </HashRouter>
            </PoolProvider>
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
