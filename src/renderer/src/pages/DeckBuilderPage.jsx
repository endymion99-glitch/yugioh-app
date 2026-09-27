import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import {
  MONSTER_KINDS,
  cardCategory,
  compareByStat,
  compareCards,
  defaultSectionFor,
  isExtraDeckType,
  isMonsterKind
} from '@shared/cardTypes.js'
import { validateDeck, availableCopies, RULES } from '@shared/deckRules.js'
import { useToast } from '../components/Toast.jsx'
import CardImage from '../components/CardImage.jsx'
import CardDetailModal from '../components/CardDetailModal.jsx'
import PromptModal from '../components/PromptModal.jsx'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'monster', label: 'Monsters' },
  { id: 'extra', label: 'Extra' },
  { id: 'spell', label: 'Spells' },
  { id: 'trap', label: 'Traps' }
]

const SORTS = [
  { id: 'type', label: 'Sort: Type', compare: compareCards },
  { id: 'atk', label: 'Sort: ATK (high → low)', compare: compareByStat('atk') },
  { id: 'def', label: 'Sort: DEF (high → low)', compare: compareByStat('def') }
]

const statText = (v) => (v === null || v === undefined ? '–' : v < 0 ? '?' : v)

const SECTION_META = {
  main: { label: 'Main Deck', range: `${RULES.main.min}–${RULES.main.max}`, cols: 'grid-cols-10' },
  extra: { label: 'Extra Deck', range: `0–${RULES.extra.max}`, cols: 'grid-cols-10' },
  side: { label: 'Side Deck', range: `0–${RULES.side.max}`, cols: 'grid-cols-10' }
}

function toEntries(deck) {
  return deck.cards.map((c) => ({ cardId: c.id, section: c.section, quantity: c.quantity }))
}

function sameEntries(a, b) {
  const key = (list) =>
    list
      .filter((e) => e.quantity > 0)
      .map((e) => `${e.section}:${e.cardId}:${e.quantity}`)
      .sort()
      .join('|')
  return key(a) === key(b)
}

export default function DeckBuilderPage({ deckId, navigate, registerGuard }) {
  const toast = useToast()
  const [decks, setDecks] = useState(null)
  const [deck, setDeck] = useState(null)
  const [collection, setCollection] = useState(null)
  const [entries, setEntries] = useState([])
  const [saved, setSaved] = useState([])
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('all')
  const [kind, setKind] = useState('')
  const [sort, setSort] = useState('type')
  const [detail, setDetail] = useState(null)
  const [prompt, setPrompt] = useState(null)
  const [saving, setSaving] = useState(false)

  const dirty = !!deck && !sameEntries(entries, saved)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  useEffect(() => {
    registerGuard(
      () => !dirtyRef.current || window.confirm('This deck has unsaved changes. Leave without saving?')
    )
  }, [])

  // Load everything; with no deck chosen, open the most recently edited one.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [list, coll] = await Promise.all([api.decks.list(), api.collection.list()])
        if (cancelled) return
        setDecks(list)
        setCollection(coll)
        const id = deckId ?? list[0]?.id
        if (id) {
          const d = await api.decks.get(id)
          if (cancelled) return
          setDeck(d)
          setEntries(toEntries(d))
          setSaved(toEntries(d))
        }
      } catch (e) {
        toast(e.message, 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deckId])

  // Every card we might need to show: the collection plus anything already in
  // the deck (a deck can reference cards later removed from the collection).
  const cardsById = useMemo(() => {
    const m = new Map()
    for (const c of collection || []) m.set(c.id, c)
    for (const c of deck?.cards || []) if (!m.has(c.id)) m.set(c.id, c)
    return m
  }, [collection, deck])

  const owned = useMemo(() => new Map((collection || []).map((c) => [c.id, c.quantity])), [collection])

  const validation = useMemo(
    () =>
      validateDeck(
        entries.map((e) => {
          const c = cardsById.get(e.cardId)
          return { ...e, name: c?.name, type: c?.type }
        }),
        owned
      ),
    [entries, cardsById, owned]
  )
  const errorCards = useMemo(
    () => new Set(validation.errors.filter((e) => e.cardId).map((e) => e.cardId)),
    [validation]
  )

  const visibleCollection = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (collection || [])
      .filter(
        (c) =>
          (!q || c.name.toLowerCase().includes(q)) &&
          (category === 'all' || cardCategory(c.type) === category) &&
          (!kind || isMonsterKind(c, kind))
      )
      .sort(SORTS.find((s) => s.id === sort).compare)
  }, [collection, filter, category, kind, sort])

  const sections = useMemo(() => {
    const out = { main: [], extra: [], side: [] }
    for (const e of entries) {
      const card = cardsById.get(e.cardId)
      if (card) out[e.section].push({ ...e, card })
    }
    for (const s of Object.keys(out)) out[s].sort((a, b) => compareCards(a.card, b.card))
    return out
  }, [entries, cardsById])

  // ------------------------------------------------------------- editing --

  const addCopy = (card, section = defaultSectionFor(card)) => {
    if (!deck) return
    if (availableCopies(card.id, entries, owned) <= 0) {
      toast(`You don't have any more copies of ${card.name}.`, 'error')
      return
    }
    setEntries((list) => {
      const i = list.findIndex((e) => e.cardId === card.id && e.section === section)
      if (i === -1) return [...list, { cardId: card.id, section, quantity: 1 }]
      return list.map((e, j) => (j === i ? { ...e, quantity: e.quantity + 1 } : e))
    })
  }

  const removeCopy = (cardId, section) =>
    setEntries((list) =>
      list
        .map((e) => (e.cardId === cardId && e.section === section ? { ...e, quantity: e.quantity - 1 } : e))
        .filter((e) => e.quantity > 0)
    )

  // Moves one copy between the Side Deck and its main/extra home.
  const moveCopy = (card, from) => {
    const to = from === 'side' ? defaultSectionFor(card) : 'side'
    setEntries((list) => {
      const next = list
        .map((e) => (e.cardId === card.id && e.section === from ? { ...e, quantity: e.quantity - 1 } : e))
        .filter((e) => e.quantity > 0)
      const i = next.findIndex((e) => e.cardId === card.id && e.section === to)
      if (i === -1) return [...next, { cardId: card.id, section: to, quantity: 1 }]
      return next.map((e, j) => (j === i ? { ...e, quantity: e.quantity + 1 } : e))
    })
  }

  // ------------------------------------------------------------- actions --

  const save = async () => {
    setSaving(true)
    try {
      const d = await api.decks.save(deck.id, entries)
      setDeck(d)
      setSaved(toEntries(d))
      setEntries(toEntries(d))
      toast(`Saved “${d.name}”.`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const create = async (name) => {
    try {
      const d = await api.decks.create(name)
      setPrompt(null)
      navigate('builder', { deckId: d.id })
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const rename = async (name) => {
    try {
      const d = await api.decks.rename(deck.id, name)
      setDeck((cur) => ({ ...cur, name: d.name }))
      setDecks((list) => list.map((x) => (x.id === d.id ? { ...x, name: d.name } : x)))
      setPrompt(null)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const remove = async () => {
    if (!window.confirm(`Delete “${deck.name}”? This can’t be undone.`)) return
    try {
      await api.decks.remove(deck.id)
      dirtyRef.current = false
      toast(`Deleted “${deck.name}”.`, 'success')
      navigate('decks')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const exportYdk = async () => {
    try {
      const res = await api.decks.exportYdk(deck.id, entries)
      if (res) toast(`Exported to ${res.filePath}`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  // ---------------------------------------------------------------- view --

  if (!decks || !collection) return <div className="h-full" />

  if (!deck) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">Deck Builder</h1>
        <p className="mt-2 max-w-sm text-sm text-white/50">
          Create a deck, then click cards from your collection to add them.
        </p>
        <button
          onClick={() => setPrompt({ kind: 'create' })}
          className="mt-6 rounded-lg bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-300"
        >
          + New deck
        </button>
        {prompt?.kind === 'create' && (
          <PromptModal title="New deck" initialValue="New Deck" confirmLabel="Create" onSubmit={create} onClose={() => setPrompt(null)} />
        )}
      </div>
    )
  }

  const { counts } = validation
  const countClass = (section) => {
    const r = RULES[section]
    return counts[section] < r.min || counts[section] > r.max ? 'text-rose-300' : 'text-emerald-300'
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/5 px-6 py-3">
        <select
          value={deck.id}
          onChange={(e) => navigate('builder', { deckId: Number(e.target.value) })}
          className="max-w-64 rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm font-semibold outline-none"
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {dirty && <span className="text-xs text-amber-300/80">● Unsaved changes</span>}
        <div className="ml-auto flex items-center gap-1 text-sm">
          <button onClick={() => setPrompt({ kind: 'create' })} className="rounded-lg px-3 py-2 text-white/70 hover:bg-white/5 hover:text-white">
            New
          </button>
          <button onClick={() => setPrompt({ kind: 'rename' })} className="rounded-lg px-3 py-2 text-white/70 hover:bg-white/5 hover:text-white">
            Rename
          </button>
          <button onClick={remove} className="rounded-lg px-3 py-2 text-rose-300/70 hover:bg-rose-500/10 hover:text-rose-200">
            Delete
          </button>
          <button onClick={exportYdk} className="rounded-lg px-3 py-2 text-white/70 hover:bg-white/5 hover:text-white">
            Export .ydk
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty || !validation.canSave}
            title={!validation.canSave ? 'Fix the problems listed below to save' : undefined}
            className="ml-2 rounded-lg bg-gold-400 px-5 py-2 font-semibold text-ink-950 hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: collection */}
        <section className="flex w-[42%] min-w-[380px] flex-col border-r border-white/5">
          <div className="space-y-2 p-4">
            <div className="flex gap-2">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search your collection…"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-950/70 px-4 py-2 text-sm outline-none placeholder:text-white/30 focus:border-gold-400/60"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded-lg border border-white/10 bg-ink-950/70 px-2 text-sm outline-none focus:border-gold-400/60"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setCategory(f.id)
                    if (f.id === 'spell' || f.id === 'trap') setKind('')
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs ${category === f.id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}
                >
                  {f.label}
                </button>
              ))}
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value)
                  if (e.target.value && (category === 'spell' || category === 'trap')) setCategory('all')
                }}
                className={`ml-auto rounded-md border bg-ink-950/70 px-2 py-1 text-xs outline-none focus:border-gold-400/60 ${kind ? 'border-gold-400/60 text-white' : 'border-white/10 text-white/60'}`}
              >
                <option value="">Any monster type</option>
                {MONSTER_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label} monsters
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-white/35">Click a card to add it · Right-click to add it to the Side Deck</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
            {collection.length === 0 && (
              <p className="mt-10 text-center text-sm text-white/40">
                Your collection is empty.{' '}
                <button onClick={() => navigate('import')} className="text-gold-300 hover:underline">
                  Import some cards
                </button>
              </p>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
              {visibleCollection.map((card) => {
                const left = availableCopies(card.id, entries, owned)
                return (
                  <div key={card.id} className="group relative">
                    <button
                      onClick={() => addCopy(card)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        addCopy(card, 'side')
                      }}
                      className={`block w-full transition ${left === 0 ? 'opacity-35 grayscale' : 'hover:-translate-y-0.5'}`}
                      title={`${card.name}${isExtraDeckType(card.type) ? ' (Extra Deck)' : ''}`}
                    >
                      <CardImage cardId={card.id} size="small" alt={card.name} />
                      <span
                        className={`absolute right-1 bottom-6 rounded bg-ink-950/90 px-1.5 text-[11px] font-bold tabular-nums ${left === 0 ? 'text-white/50' : 'text-gold-300'}`}
                      >
                        {left}/{card.quantity}
                      </span>
                      <div className="mt-1 truncate text-[11px] text-white/60">{card.name}</div>
                      {sort !== 'type' && ['monster', 'extra'].includes(cardCategory(card.type)) && (
                        <div className="text-[10px] tabular-nums text-white/45">
                          <span className={sort === 'atk' ? 'text-gold-300' : ''}>ATK {statText(card.atk)}</span>
                          {' / '}
                          <span className={sort === 'def' ? 'text-gold-300' : ''}>
                            {card.linkval != null ? `LINK ${card.linkval}` : `DEF ${statText(card.def)}`}
                          </span>
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => setDetail(card)}
                      className="absolute top-1 right-1 hidden h-5 w-5 items-center justify-center rounded-full bg-ink-950/90 text-[11px] text-white/80 group-hover:flex"
                      title="Details"
                    >
                      i
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* Right: deck */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-auto px-6 py-4">
            {['main', 'extra', 'side'].map((section) => (
              <div key={section}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="font-semibold">{SECTION_META[section].label}</h2>
                  <span className={`text-sm font-semibold tabular-nums ${countClass(section)}`}>{counts[section]}</span>
                  <span className="text-xs text-white/35">({SECTION_META[section].range})</span>
                  {section === 'main' && (
                    <span className="ml-auto text-[11px] text-white/35">Click: remove · Right-click: move to/from Side</span>
                  )}
                </div>
                <div
                  className={`grid ${SECTION_META[section].cols} min-h-20 gap-1.5 rounded-xl border border-white/5 bg-ink-950/40 p-2`}
                >
                  {sections[section].flatMap((e) =>
                    Array.from({ length: e.quantity }, (_, i) => (
                      <button
                        key={`${e.cardId}-${i}`}
                        onClick={() => removeCopy(e.cardId, section)}
                        onContextMenu={(ev) => {
                          ev.preventDefault()
                          moveCopy(e.card, section)
                        }}
                        title={e.card.name}
                        className={`relative transition hover:-translate-y-0.5 hover:brightness-110 ${errorCards.has(e.cardId) ? 'rounded-md ring-2 ring-rose-400' : ''}`}
                      >
                        <CardImage cardId={e.cardId} size="small" alt={e.card.name} />
                      </button>
                    ))
                  )}
                  {sections[section].length === 0 && (
                    <div className="col-span-full flex items-center justify-center py-5 text-xs text-white/25">
                      {section === 'side'
                        ? 'Right-click cards to put them in the Side Deck'
                        : section === 'extra'
                          ? 'Fusion, Synchro, XYZ and Link monsters go here automatically'
                          : 'Click cards on the left to add them'}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Validation */}
          <div className="max-h-44 shrink-0 overflow-auto border-t border-white/5 bg-ink-950/50 px-6 py-3 text-sm">
            {validation.errors.length === 0 ? (
              <p className="text-emerald-300">✓ Deck is legal and ready to save.</p>
            ) : (
              <ul className="space-y-1">
                {validation.errors.map((err, i) => (
                  <li key={i} className="flex gap-2 text-rose-200/90">
                    <span className="text-rose-400">!</span>
                    {err.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {detail && <CardDetailModal card={detail} onClose={() => setDetail(null)} />}
      {prompt?.kind === 'create' && (
        <PromptModal title="New deck" initialValue="New Deck" confirmLabel="Create" onSubmit={create} onClose={() => setPrompt(null)} />
      )}
      {prompt?.kind === 'rename' && (
        <PromptModal title="Rename deck" initialValue={deck.name} confirmLabel="Rename" onSubmit={rename} onClose={() => setPrompt(null)} />
      )}
    </div>
  )
}
