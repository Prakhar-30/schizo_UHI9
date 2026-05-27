import { createContext, useContext, useState, useCallback } from 'react'

const ToastCtx = createContext({ toast: () => {}, dismiss: () => {} })
export const useToast = () => useContext(ToastCtx)

const ACCENT = {
  success: 'border-yield text-yield',
  error: 'border-risk text-risk',
  info: 'border-volt text-volt',
  pending: 'border-mint text-mint',
}

const ICON = {
  success: '✓',
  error: '✕',
  info: 'i',
  pending: '◴',
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])

  const dismiss = useCallback((id) => {
    setItems((xs) => xs.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback(
    ({ title, desc, variant = 'info', link, duration = 6000 }) => {
      const id = Math.random().toString(36).slice(2)
      setItems((xs) => [...xs, { id, title, desc, variant, link }])
      if (duration) setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss],
  )

  return (
    <ToastCtx.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-[min(92vw,380px)] flex-col gap-3">
        {items.map((t) => (
          <div
            key={t.id}
            className={`card-flat glass-strong flex items-start gap-3 p-4 ${
              ACCENT[t.variant]?.split(' ')[0] || ''
            } border-l-4 animate-[float_0.01s] `}
            style={{ animation: 'none' }}
          >
            <span
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border font-mono text-xs font-bold ${ACCENT[t.variant]}`}
            >
              {t.variant === 'pending' ? (
                <span className="block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                ICON[t.variant]
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-bold text-bone">{t.title}</p>
              {t.desc && <p className="mt-0.5 text-xs text-bone/55 break-words">{t.desc}</p>}
              {t.link && (
                <a
                  href={t.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block font-mono text-[11px] uppercase tracking-wider text-volt underline underline-offset-2 hover:text-bone"
                >
                  {t.link.label} ↗
                </a>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-bone/30 hover:text-bone text-sm leading-none"
              aria-label="dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
