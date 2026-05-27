import { useEffect } from 'react'

export default function Modal({ open, onClose, title, children, maxW = 'max-w-md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`card glass-strong relative w-full ${maxW} p-6`}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-black text-lg tracking-tight">{title}</h3>
          <button onClick={onClose} className="text-bone/40 hover:text-bone text-lg leading-none">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
