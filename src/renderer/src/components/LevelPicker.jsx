import { useEffect, useRef, useState } from 'react'
import { LEVELS } from '@shared/cardTypes.js'

/**
 * Dropdown for picking any number of monster levels. `counts` maps a level
 * to how many of the player's monsters have it, so empty levels can be
 * told apart at a glance.
 */
export default function LevelPicker({ selected, onChange, counts }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (level) =>
    onChange(
      selected.includes(level) ? selected.filter((l) => l !== level) : [...selected, level].sort((a, b) => a - b)
    )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-md border bg-ink-950/70 px-2 py-1 text-xs ${selected.length ? 'border-gold-400/60 text-white' : 'border-white/10 text-white/60 hover:text-white'}`}
      >
        {selected.length ? `Levels: ${selected.join(', ')}` : 'All levels'}
        <span className="text-[9px] text-white/40">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-white/10 bg-ink-850 p-2 shadow-xl">
          <div className="grid grid-cols-4 gap-1">
            {LEVELS.map((level) => {
              const on = selected.includes(level)
              const n = counts.get(level) || 0
              return (
                <button
                  key={level}
                  onClick={() => toggle(level)}
                  title={`${n} monster${n === 1 ? '' : 's'} in your collection`}
                  className={`rounded-md border px-1 py-1 text-xs tabular-nums ${on ? 'border-gold-400/70 bg-gold-400/15 text-white' : 'border-white/10 hover:bg-white/5'} ${!on && n === 0 ? 'text-white/30' : 'text-white/80'}`}
                >
                  ★{level}
                  <span className="ml-1 text-[10px] text-white/40">{n}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <button onClick={() => onChange([])} disabled={!selected.length} className="text-white/50 hover:text-white disabled:opacity-30">
              Clear
            </button>
            <button onClick={() => setOpen(false)} className="text-gold-300 hover:underline">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
