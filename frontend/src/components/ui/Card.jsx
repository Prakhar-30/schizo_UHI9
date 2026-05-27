export function Card({ className = '', glow, hover = false, children, ...props }) {
  const glowCls = glow ? `glow-${glow}` : ''
  const hoverCls = hover
    ? 'transition-transform duration-200 hover:-translate-y-1'
    : ''
  return (
    <div className={`card ${glowCls} ${hoverCls} ${className}`} {...props}>
      {children}
    </div>
  )
}

export function Glass({ strong = false, className = '', children, ...props }) {
  return (
    <div className={`${strong ? 'glass-strong' : 'glass'} rounded-2xl ${className}`} {...props}>
      {children}
    </div>
  )
}
