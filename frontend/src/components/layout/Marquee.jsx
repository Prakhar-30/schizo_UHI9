export default function Marquee({ items, className = '', sep = '◆' }) {
  const row = (
    <div className="flex shrink-0 items-center">
      {items.map((it, i) => (
        <span key={i} className="flex items-center">
          <span className="px-5 font-mono text-[12px] uppercase tracking-[0.2em]">{it}</span>
          <span className="text-volt/70">{sep}</span>
        </span>
      ))}
    </div>
  )
  return (
    <div className={`flex overflow-hidden ${className}`}>
      <div className="flex animate-marquee whitespace-nowrap">
        {row}
        {row}
      </div>
    </div>
  )
}
