import { useState } from 'react'
import { api } from '../lib/api.js'

export default function AuthPage({ mode, onAuthed }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const registering = mode === 'register'

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (registering && password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const user = registering
        ? await api.auth.register(username, password)
        : await api.auth.login(username, password)
      onAuthed(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const input =
    'w-full rounded-lg border border-white/10 bg-ink-950/70 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-gold-400/60'

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_#26264a_0%,_#0f0f1a_55%,_#07070f_100%)]">
      <form
        onSubmit={submit}
        className="w-[380px] rounded-2xl border border-white/10 bg-ink-850/80 p-8 shadow-2xl backdrop-blur"
      >
        <div className="text-[10px] font-semibold tracking-[0.3em] text-gold-400/80 uppercase">Yu-Gi-Oh!</div>
        <h1 className="mt-1 text-2xl font-bold">Collection Manager</h1>
        <p className="mt-2 text-sm text-white/50">
          {registering
            ? 'Welcome, duelist. Create your profile to start tracking your cards.'
            : 'Welcome back. Log in to open your collection.'}
        </p>

        <div className="mt-6 space-y-3">
          <input
            className={input}
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            className={input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {registering && (
            <input
              className={input}
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </div>

        {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

        <button
          disabled={busy || !username || !password}
          className="mt-6 w-full rounded-lg bg-gold-400 py-3 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 disabled:opacity-40"
        >
          {busy ? 'Please wait…' : registering ? 'Create profile' : 'Log in'}
        </button>
      </form>
    </div>
  )
}
