import { useState } from 'react'
import Modal from './Modal.jsx'

// Electron doesn't implement window.prompt, so text input goes through this.
export default function PromptModal({ title, initialValue = '', confirmLabel = 'OK', onSubmit, onClose }) {
  const [value, setValue] = useState(initialValue)
  const submit = (e) => {
    e.preventDefault()
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <Modal onClose={onClose} className="w-[420px]">
      <form onSubmit={submit} className="p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <input
          autoFocus
          value={value}
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="mt-4 w-full rounded-lg border border-white/10 bg-ink-950/70 px-4 py-2.5 text-sm outline-none focus:border-gold-400/60"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-white/60 hover:bg-white/5">
            Cancel
          </button>
          <button
            disabled={!value.trim()}
            className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-gold-300 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
