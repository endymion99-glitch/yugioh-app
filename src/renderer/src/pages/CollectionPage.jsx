import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'
import { isMonster } from '@shared/cardTypes.js'
import { applyFilters, filterCounts, hasLevelFilters, levelBadge, statText } from '@shared/cardFilters.js'
import CardImage from '../components/CardImage.jsx'
import CardDetailModal from '../components/CardDetailModal.jsx'
import CardSearch from '../components/CardSearch.jsx'
import Modal from '../components/Modal.jsx'
import CardFilterBar, { NoMatches, useCardFilters } from '../components/CardFilterBar.jsx'

export default function CollectionPage({ navigate }) {
  const toast = useToast()
  const [cards, setCards] = useState(null)
  const filterState = useCardFilters('name')
  const { filters, sort } = filterState
  const [detail, setDetail] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = () =>
    api.collection
      .list()
      .then(setCards)
      .catch((e) => toast(e.message, 'error'))

  useEffect(() => {
    load()
  }, [])

  const visible = useMemo(() => applyFilters(cards || [], filters, sort), [cards, filters, sort])
  const filterOptionCounts = useMemo(() => filterCounts(cards || [], filters), [cards, filters])
  const showLevel = hasLevelFilters(filters.category) && (!!filters.levelSort || filters.levels.length > 0)

  const totals = useMemo(
    () => ({
      unique: cards?.length ?? 0,
      copies: cards?.reduce((s, c) => s + c.quantity, 0) ?? 0
    }),
    [cards]
  )

  const setQuantity = async (card, quantity) => {
    try {
      await api.collection.setQuantity(card.id, quantity)
      setDetail((d) => (d && d.id === card.id ? { ...d, quantity } : d))
      setCards((list) => {
        const rest = list.filter((c) => c.id !== card.id)
        if (quantity <= 0) return rest
        // Re-adding a card that was just dropped to zero puts it back.
        return list.length === rest.length
          ? [...rest, { ...card, quantity }].sort((a, b) => a.name.localeCompare(b.name))
          : list.map((c) => (c.id === card.id ? { ...c, quantity } : c))
      })
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const addManual = async (card, quantity) => {
    try {
      await api.collection.add([{ cardId: card.id, quantity }])
      toast(`Added ${quantity}× ${card.name}`, 'success')
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-white/5 px-8 py-5">
        <div>
          <h1 className="text-2xl font-bold">Your Collection</h1>
          <p className="text-sm text-white/40">
            {totals.unique} unique cards · {totals.copies} total copies
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
          >
            + Add card
          </button>
          <button
            onClick={() => navigate('import')}
            className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-gold-300"
          >
            Import packs
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 px-8 py-4">
        <CardFilterBar
          state={filterState}
          counts={filterOptionCounts}
          sorts={['name', 'type', 'quantity', 'atk', 'def']}
          placeholder="Filter by card name…"
          wide
        />
        {cards && cards.length > 0 && visible.length !== cards.length && (
          <span className="text-xs text-white/40">
            Showing {visible.length} of {cards.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-8 pb-10">
        {cards && cards.length === 0 && (
          <div className="mx-auto mt-24 max-w-md text-center">
            <div className="text-5xl opacity-30">🂠</div>
            <h2 className="mt-4 text-lg font-semibold">Your binder is empty</h2>
            <p className="mt-2 text-sm text-white/50">
              Import a screenshot of your opened packs, a .txt list or a .ydk file — or add cards by
              hand.
            </p>
            <button
              onClick={() => navigate('import')}
              className="mt-6 rounded-lg bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-300"
            >
              Import your first packs
            </button>
          </div>
        )}
        {cards && cards.length > 0 && visible.length === 0 && <NoMatches onReset={filterState.reset} />}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-6">
          {visible.map((card) => (
            <button
              key={card.id}
              onClick={() => setDetail(card)}
              className="group text-left focus:outline-none"
              title={card.name}
            >
              <div className="relative transition duration-200 group-hover:-translate-y-1 group-hover:drop-shadow-[0_12px_24px_rgba(233,196,106,0.25)]">
                <CardImage cardId={card.id} alt={card.name} />
                {showLevel && levelBadge(card) && (
                  <span className="absolute top-1.5 left-1.5 rounded-md bg-ink-950/90 px-2 py-0.5 text-sm font-bold text-gold-300 tabular-nums shadow">
                    {levelBadge(card)}
                  </span>
                )}
                <span className="absolute right-1.5 bottom-1.5 rounded-md border border-gold-300/40 bg-ink-950/90 px-2 py-0.5 text-sm font-bold text-gold-300 tabular-nums shadow">
                  ×{card.quantity}
                </span>
              </div>
              <div className="mt-2 truncate text-xs text-white/75 group-hover:text-white">{card.name}</div>
              {(sort === 'atk' || sort === 'def') && isMonster(card) && (
                <div className="text-[11px] text-white/45 tabular-nums">
                  <span className={sort === 'atk' ? 'text-gold-300' : ''}>ATK {statText(card.atk)}</span>
                  {' / '}
                  <span className={sort === 'def' ? 'text-gold-300' : ''}>
                    {card.linkval != null ? `LINK ${card.linkval}` : `DEF ${statText(card.def)}`}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {detail && (
        <CardDetailModal
          card={detail}
          quantity={detail.quantity}
          onQuantityChange={(q) => setQuantity(detail, q)}
          onClose={() => setDetail(null)}
        />
      )}

      {adding && (
        <Modal onClose={() => setAdding(false)} className="flex h-[600px] w-[520px] flex-col p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Add cards manually</h2>
            <button onClick={() => setAdding(false)} className="text-2xl leading-none text-white/40 hover:text-white">
              ×
            </button>
          </div>
          <CardSearch onAdd={addManual} addLabel="Add to collection" autoFocus />
        </Modal>
      )}
    </div>
  )
}
