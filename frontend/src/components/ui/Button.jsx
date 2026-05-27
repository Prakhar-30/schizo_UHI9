import { Link } from 'react-router-dom'

const VARIANTS = {
  primary:
    'bg-volt text-white border-volt hover:bg-volt-dim shadow-[4px_4px_0_0_#08080a]',
  bone:
    'bg-bone text-ink border-bone hover:bg-white shadow-[4px_4px_0_0_#08080a]',
  yield:
    'bg-yield text-ink border-yield hover:brightness-110 shadow-[4px_4px_0_0_#08080a]',
  risk:
    'bg-risk text-white border-risk hover:brightness-110 shadow-[4px_4px_0_0_#08080a]',
  outline:
    'bg-transparent text-bone border-white/25 hover:border-bone hover:bg-white/5',
  ghost:
    'bg-white/5 text-bone border-white/10 hover:bg-white/10 shadow-none',
}

const SIZES = {
  sm: 'text-xs px-3 py-2 gap-1.5',
  md: 'text-sm px-5 py-3 gap-2',
  lg: 'text-base px-7 py-4 gap-2.5',
}

export default function Button({
  as,
  to,
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  loading = false,
  disabled = false,
  children,
  ...props
}) {
  const base =
    'group relative inline-flex items-center justify-center font-mono font-bold uppercase tracking-wider border-2 rounded-lg select-none transition-all duration-150 ' +
    'hover:-translate-x-[2px] hover:-translate-y-[2px] active:translate-x-0 active:translate-y-0 active:shadow-none ' +
    'disabled:opacity-45 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-volt/70'
  const cls = `${base} ${VARIANTS[variant]} ${SIZES[size]} ${className}`
  const content = (
    <>
      {loading && (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {children}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={cls} {...props}>
        {content}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls} {...props}>
        {content}
      </a>
    )
  }
  return (
    <button className={cls} disabled={disabled || loading} {...props}>
      {content}
    </button>
  )
}
