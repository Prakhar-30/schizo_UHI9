export function Field({ label, hint, children, right }) {
  return (
    <label className="block">
      {(label || right) && (
        <div className="mb-2 flex items-center justify-between">
          {label && <span className="kicker">{label}</span>}
          {right}
        </div>
      )}
      {children}
      {hint && <p className="mt-1.5 font-mono text-[11px] text-bone/40">{hint}</p>}
    </label>
  )
}

export function Input({ suffix, onMax, className = '', invalid = false, ...props }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border-2 bg-ink-soft/70 px-4 py-3 transition-colors focus-within:border-volt ${
        invalid ? 'border-risk/70' : 'border-white/12'
      } ${className}`}
    >
      <input
        className="min-w-0 flex-1 bg-transparent font-mono text-lg text-bone outline-none placeholder:text-bone/25"
        {...props}
      />
      {onMax && (
        <button
          type="button"
          onClick={onMax}
          className="font-mono text-[11px] uppercase tracking-wider text-volt hover:text-bone"
        >
          Max
        </button>
      )}
      {suffix && <span className="font-mono text-sm font-bold text-bone/60">{suffix}</span>}
    </div>
  )
}
