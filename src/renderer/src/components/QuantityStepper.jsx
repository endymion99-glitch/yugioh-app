export default function QuantityStepper({ value, onChange, min = 0, max = 99, size = 'md' }) {
  const btn =
    size === 'sm'
      ? 'h-6 w-6 text-sm'
      : 'h-8 w-8 text-base'
  const set = (n) => onChange(Math.max(min, Math.min(max, n)))
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-white/10 bg-ink-950/60">
      <button
        type="button"
        className={`${btn} text-white/70 hover:bg-white/10 disabled:opacity-30`}
        onClick={() => set(value - 1)}
        disabled={value <= min}
        aria-label="Decrease"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => set(Number(e.target.value) || 0)}
        className={`${size === 'sm' ? 'w-8 text-xs' : 'w-10 text-sm'} bg-transparent text-center font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
      />
      <button
        type="button"
        className={`${btn} text-white/70 hover:bg-white/10 disabled:opacity-30`}
        onClick={() => set(value + 1)}
        disabled={value >= max}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  )
}
