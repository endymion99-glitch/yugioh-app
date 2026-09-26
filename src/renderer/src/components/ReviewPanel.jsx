import { useMemo, useState } from 'react'
import CardImage from './CardImage.jsx'
import CardSearch from './CardSearch.jsx'
import QuantityStepper from './QuantityStepper.jsx'

/**
 * Import review: shows matched cards (editable quantities), OCR text that
 * didn't match anything, and a manual search to add missed cards.
 */
export default function ReviewPanel({ found, setFound, unrecognized, setUnrecognized, preview, onConfirm, onCancel, busy }) {
  const [searchText, setSearchText] = useState('')
  const [showPreview, setShowPreview] = useState(!!preview)

  const copies = useMemo(() => found.reduce((s, f) => s + f.quantity, 0), [found])

  const setQty = (id, quantity) =>
    setFound((list) => list.map((f) => (f.card.id === id ? { ...f, quantity } : f)))
  const remove = (id) => setFound((list) => list.filter((f) => f.card.id !== id))
  const addCard = (card, quantity) =>
    setFound((list) =>
      list.some((f) => f.card.id === card.id)
        ? list.map((f) => (f.card.id === card.id ? { ...f, quantity: f.quantity + quantity } : f))
        : [...list, { card, quantity, from: 'manual' }]
    )

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-300">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-sm">✓</span>
            Cards found
            <span className="text-sm font-normal text-white/40">
              {found.length} cards · {copies} copies
            </span>
          </h2>
          {found.length === 0 && (
            <p className="mt-3 text-sm text-white/40">
              No cards yet — use the search on the right to add them.
            </p>
          )}
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-5">
            {found.map((f) => (
              <div key={f.card.id} className="group relative">
                <button
                  onClick={() => remove(f.card.id)}
                  className="absolute -top-2 -right-2 z-10 hidden h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-sm font-bold text-white shadow group-hover:flex"
                  title="Remove"
                >
                  ×
                </button>
                <CardImage cardId={f.card.id} alt={f.card.name} className={f.quantity === 0 ? 'opacity-30' : ''} />
                <div className="mt-2 truncate text-xs font-medium" title={f.card.name}>
                  {f.card.name}
                </div>
                {f.from && f.from !== 'manual' && f.from.toLowerCase() !== f.card.name.toLowerCase() && !/^\d+$/.test(f.from) && (
                  <div className="truncate text-[10px] text-white/35" title={`Read as “${f.from}”`}>
                    read as “{f.from}”
                  </div>
                )}
                {f.from === 'manual' && <div className="text-[10px] text-sky-300/70">added manually</div>}
                <div className="mt-1.5">
                  <QuantityStepper value={f.quantity} onChange={(q) => setQty(f.card.id, q)} min={0} size="sm" />
                </div>
              </div>
            ))}
          </div>

          {unrecognized.length > 0 && (
            <div className="mt-10">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-rose-300">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/20 text-sm">✕</span>
                Not recognized
                <span className="text-sm font-normal text-white/40">
                  click one to search for it
                </span>
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {unrecognized.map((u, i) => (
                  <span
                    key={`${u.text}-${i}`}
                    className="inline-flex items-center gap-1 rounded-full border border-rose-400/25 bg-rose-500/10 pl-3 text-sm text-rose-100"
                  >
                    <button onClick={() => setSearchText(u.text.replace(/\.\.\.$/, ''))} className="py-1 hover:underline" title="Search for this">
                      {u.text}
                      {u.quantity > 1 && <span className="ml-1 text-rose-300/70">×{u.quantity}</span>}
                    </button>
                    <button
                      onClick={() => setUnrecognized((list) => list.filter((_, j) => j !== i))}
                      className="px-2 py-1 text-rose-300/60 hover:text-white"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-white/5 bg-ink-950/60 px-8 py-4">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white">
            Cancel
          </button>
          <div className="ml-auto text-sm text-white/50">
            {copies} {copies === 1 ? 'copy' : 'copies'} will be added to your collection
          </div>
          <button
            onClick={onConfirm}
            disabled={busy || copies === 0}
            className="rounded-lg bg-gold-400 px-6 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-300 disabled:opacity-40"
          >
            {busy ? 'Adding…' : 'Confirm'}
          </button>
        </footer>
      </section>

      <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/5 bg-ink-950/40 p-5">
        {preview && (
          <div className="mb-4">
            <button onClick={() => setShowPreview((v) => !v)} className="text-xs text-white/50 hover:text-white">
              {showPreview ? '▾ Hide screenshot' : '▸ Show screenshot'}
            </button>
            {showPreview && (
              <img src={preview} alt="Imported screenshot" className="mt-2 max-h-64 w-full rounded-lg border border-white/10 object-contain" />
            )}
          </div>
        )}
        <h3 className="mb-1 text-sm font-semibold">Add missed cards</h3>
        <p className="mb-3 text-xs text-white/40">Search YGOprodeck and add anything the import missed.</p>
        <div className="flex min-h-0 flex-1 flex-col">
          <CardSearch onAdd={addCard} initialQuery={searchText} />
        </div>
      </aside>
    </div>
  )
}
