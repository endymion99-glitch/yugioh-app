import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { RULES } from '@shared/deckRules.js'
import { useToast } from '../components/Toast.jsx'
import CardImage from '../components/CardImage.jsx'
import PromptModal from '../components/PromptModal.jsx'

const sizeOk = (d) =>
  d.mainCount >= RULES.main.min &&
  d.mainCount <= RULES.main.max &&
  d.extraCount <= RULES.extra.max &&
  d.sideCount <= RULES.side.max

function formatDate(s) {
  if (!s) return ''
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
  const d = new Date(s.replace(' ', 'T') + 'Z')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DeckListPage({ navigate }) {
  const toast = useToast()
  const [decks, setDecks] = useState(null)
  const [prompt, setPrompt] = useState(null)

  const load = () =>
    api.decks
      .list()
      .then(setDecks)
      .catch((e) => toast(e.message, 'error'))

  useEffect(() => {
    load()
  }, [])

  const create = async (name) => {
    try {
      const deck = await api.decks.create(name)
      navigate('builder', { deckId: deck.id })
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const rename = async (deck, name) => {
    try {
      await api.decks.rename(deck.id, name)
      setPrompt(null)
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const remove = async (deck) => {
    if (!window.confirm(`Delete “${deck.name}”? This can’t be undone.`)) return
    try {
      await api.decks.remove(deck.id)
      toast(`Deleted “${deck.name}”.`, 'success')
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const exportYdk = async (deck) => {
    try {
      const res = await api.decks.exportYdk(deck.id)
      if (res) toast(`Exported to ${res.filePath}`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center border-b border-white/5 px-8 py-5">
        <div>
          <h1 className="text-2xl font-bold">Your Decks</h1>
          <p className="text-sm text-white/40">{decks ? `${decks.length} saved` : ' '}</p>
        </div>
        <button
          onClick={() => setPrompt({ kind: 'create' })}
          className="ml-auto rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-gold-300"
        >
          + New deck
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        {decks && decks.length === 0 && (
          <div className="mt-24 text-center">
            <h2 className="text-lg font-semibold">No decks yet</h2>
            <p className="mt-2 text-sm text-white/50">Build your first deck from the cards you own.</p>
            <button
              onClick={() => setPrompt({ kind: 'create' })}
              className="mt-6 rounded-lg bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-300"
            >
              Create a deck
            </button>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5">
          {decks?.map((d) => (
            <div key={d.id} className="group flex overflow-hidden rounded-2xl border border-white/10 bg-ink-850 transition hover:border-gold-400/40">
              <button onClick={() => navigate('builder', { deckId: d.id })} className="w-24 shrink-0 bg-ink-950 p-2">
                {d.coverCardId ? (
                  <CardImage cardId={d.coverCardId} size="small" alt="" />
                ) : (
                  <div className="flex aspect-[421/614] items-center justify-center rounded-md border border-dashed border-white/10 text-xs text-white/30">
                    Empty
                  </div>
                )}
              </button>
              <div className="flex min-w-0 flex-1 flex-col p-4">
                <button
                  onClick={() => navigate('builder', { deckId: d.id })}
                  className="truncate text-left font-semibold hover:text-gold-300"
                  title={d.name}
                >
                  {d.name}
                </button>
                <div className="mt-1 text-xs text-white/40">Updated {formatDate(d.updatedAt)}</div>
                <div className="mt-3 flex gap-3 text-xs text-white/70 tabular-nums">
                  <span>Main {d.mainCount}</span>
                  <span>Extra {d.extraCount}</span>
                  <span>Side {d.sideCount}</span>
                </div>
                <div className="mt-1 text-xs">
                  {sizeOk(d) ? (
                    <span className="text-emerald-300/80">✓ Legal size</span>
                  ) : (
                    <span className="text-amber-300/80">Needs work</span>
                  )}
                </div>
                <div className="mt-auto flex flex-wrap gap-1 pt-3 text-xs">
                  <button onClick={() => navigate('builder', { deckId: d.id })} className="rounded-md bg-white/5 px-2.5 py-1 hover:bg-white/10">
                    Open
                  </button>
                  <button onClick={() => setPrompt({ kind: 'rename', deck: d })} className="rounded-md px-2.5 py-1 text-white/60 hover:bg-white/5 hover:text-white">
                    Rename
                  </button>
                  <button onClick={() => exportYdk(d)} className="rounded-md px-2.5 py-1 text-white/60 hover:bg-white/5 hover:text-white">
                    Export
                  </button>
                  <button onClick={() => remove(d)} className="ml-auto rounded-md px-2.5 py-1 text-rose-300/70 hover:bg-rose-500/10 hover:text-rose-200">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {prompt?.kind === 'create' && (
        <PromptModal title="New deck" initialValue="New Deck" confirmLabel="Create" onSubmit={create} onClose={() => setPrompt(null)} />
      )}
      {prompt?.kind === 'rename' && (
        <PromptModal
          title="Rename deck"
          initialValue={prompt.deck.name}
          confirmLabel="Rename"
          onSubmit={(name) => rename(prompt.deck, name)}
          onClose={() => setPrompt(null)}
        />
      )}
    </div>
  )
}
