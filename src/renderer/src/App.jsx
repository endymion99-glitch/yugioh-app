import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { ToastProvider } from './components/Toast.jsx'
import AuthPage from './pages/AuthPage.jsx'
import CollectionPage from './pages/CollectionPage.jsx'
import ImportPage from './pages/ImportPage.jsx'
import DeckListPage from './pages/DeckListPage.jsx'
import DeckBuilderPage from './pages/DeckBuilderPage.jsx'

const NAV = [
  { id: 'collection', label: 'Collection', icon: '▦' },
  { id: 'import', label: 'Import', icon: '⇪' },
  { id: 'decks', label: 'Decks', icon: '☰' },
  { id: 'builder', label: 'Deck Builder', icon: '✦' }
]

export default function App() {
  const [status, setStatus] = useState(null)
  const [route, setRoute] = useState({ page: 'collection' })
  // Pages with unsaved work register a guard that confirms navigation.
  const [leaveGuard, setLeaveGuard] = useState(null)

  useEffect(() => {
    api.auth.status().then(setStatus)
  }, [])

  const navigate = useCallback(
    (page, params = {}) => {
      if (leaveGuard && !leaveGuard()) return
      setLeaveGuard(null)
      setRoute({ page, ...params })
    },
    [leaveGuard]
  )

  if (!status) return <div className="h-full bg-ink-900" />

  if (!status.user) {
    return (
      <AuthPage
        mode={status.hasUser ? 'login' : 'register'}
        onAuthed={(user) => setStatus({ hasUser: true, user })}
      />
    )
  }

  const logout = async () => {
    if (leaveGuard && !leaveGuard()) return
    await api.auth.logout()
    setLeaveGuard(null)
    setRoute({ page: 'collection' })
    setStatus({ hasUser: true, user: null })
  }

  const registerGuard = (fn) => setLeaveGuard(() => fn)

  return (
    <ToastProvider>
      <div className="flex h-full">
        <aside className="flex w-56 shrink-0 flex-col border-r border-white/5 bg-ink-950">
          <div className="px-5 pt-6 pb-8">
            <div className="text-[10px] font-semibold tracking-[0.3em] text-gold-400/80 uppercase">
              Yu-Gi-Oh!
            </div>
            <div className="mt-1 text-lg leading-tight font-bold">Collection Manager</div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {NAV.map((n) => {
              const active = route.page === n.id
              return (
                <button
                  key={n.id}
                  onClick={() => navigate(n.id)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                    active
                      ? 'bg-gold-400/10 font-semibold text-gold-300'
                      : 'text-white/60 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="w-4 text-center opacity-80">{n.icon}</span>
                  {n.label}
                </button>
              )
            })}
          </nav>
          <div className="border-t border-white/5 px-5 py-4 text-sm">
            <div className="truncate text-white/80">{status.user.username}</div>
            <button onClick={logout} className="mt-1 text-xs text-white/40 hover:text-white">
              Log out
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          {route.page === 'collection' && <CollectionPage navigate={navigate} />}
          {route.page === 'import' && <ImportPage navigate={navigate} registerGuard={registerGuard} />}
          {route.page === 'decks' && <DeckListPage navigate={navigate} />}
          {route.page === 'builder' && (
            <DeckBuilderPage
              key={route.deckId ?? 'none'}
              deckId={route.deckId}
              navigate={navigate}
              registerGuard={registerGuard}
            />
          )}
        </main>
      </div>
    </ToastProvider>
  )
}
