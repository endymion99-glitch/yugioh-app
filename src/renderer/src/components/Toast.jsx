import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2)
    // Repeating a message replaces the old copy; at most 4 are shown.
    setToasts((t) => [...t.filter((x) => x.message !== message), { id, message, kind }].slice(-4))
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])

  const colors = {
    info: 'border-sky-400/40 bg-sky-950/90',
    success: 'border-emerald-400/40 bg-emerald-950/90',
    error: 'border-rose-400/40 bg-rose-950/90'
  }

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm whitespace-pre-line shadow-xl ${colors[t.kind]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
