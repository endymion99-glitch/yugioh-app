import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { useDebounced } from '../lib/useDebounced.js'
import CardImage from './CardImage.jsx'
import CardTypeTag from './CardTypeTag.jsx'
import QuantityStepper from './QuantityStepper.jsx'

/**
 * Live YGOprodeck search. Calls onAdd(card, quantity) when the player adds
 * a result. Used on the Collection page and inside the import review panel.
 */
export default function CardSearch({ onAdd, initialQuery = '', addLabel = 'Add', autoFocus = false }) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [offline, setOffline] = useState(false)
  const [selected, setSelected] = useState(null)
  const [qty, setQty] = useState(1)
  const debounced = useDebounced(query.trim(), 300)
  const seq = useRef(0)

  useEffect(() => setQuery(initialQuery), [initialQuery])

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([])
      setError(null)
      return
    }
    const mine = ++seq.current
    setLoading(true)
    api.cards
      .search(debounced)
      .then((r) => {
        if (mine !== seq.current) return
        setResults(r.cards)
        setOffline(r.offline)
        setError(null)
      })
      .catch((e) => mine === seq.current && setError(e.message))
      .finally(() => mine === seq.current && setLoading(false))
  }, [debounced])

  const add = (card, n) => {
    onAdd(card, n)
    setSelected(null)
    setQty(1)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="relative">
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any card by name…"
          className="w-full rounded-lg border border-white/10 bg-ink-950/70 px-4 py-2.5 pr-10 text-sm outline-none placeholder:text-white/30 focus:border-gold-400/60"
        />
        {loading && (
          <span className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-white/20 border-t-gold-400" />
        )}
      </div>
      {offline && (
        <p className="mt-2 text-xs text-amber-300/80">Offline — showing cached cards only.</p>
      )}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {debounced.length >= 2 && !loading && !results.length && !error && (
        <p className="mt-3 text-sm text-white/40">No cards found for “{debounced}”.</p>
      )}

      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
        {results.map((card) => {
          const open = selected === card.id
          return (
            <li
              key={card.id}
              className={`rounded-lg border transition ${open ? 'border-gold-400/40 bg-white/5' : 'border-transparent hover:bg-white/5'}`}
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 p-1.5 text-left"
                onClick={() => {
                  setSelected(open ? null : card.id)
                  setQty(1)
                }}
                onDoubleClick={() => add(card, 1)}
              >
                <div className="w-10 shrink-0">
                  <CardImage cardId={card.id} size="small" alt={card.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{card.name}</div>
                  <CardTypeTag type={card.type} className="mt-1" />
                </div>
              </button>
              {open && (
                <div className="flex items-center justify-end gap-2 px-2 pb-2">
                  <QuantityStepper value={qty} onChange={setQty} min={1} size="sm" />
                  <button
                    type="button"
                    onClick={() => add(card, qty)}
                    className="rounded-md bg-gold-400 px-3 py-1 text-xs font-semibold text-ink-950 hover:bg-gold-300"
                  >
                    {addLabel}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
