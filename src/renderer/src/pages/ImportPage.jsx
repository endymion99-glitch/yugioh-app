import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { prepareScreenshot } from '../lib/screenshot.js'
import { useToast } from '../components/Toast.jsx'
import ReviewPanel from '../components/ReviewPanel.jsx'

const METHODS = [
  {
    id: 'screenshot',
    title: 'Screenshot',
    icon: '🖼',
    accept: 'image/*',
    blurb: 'Upload (or paste with Ctrl+V) a screenshot of your opened packs from YGOprodeck.'
  },
  {
    id: 'txt',
    title: 'Text file',
    icon: '📄',
    accept: '.txt,text/plain',
    blurb: 'A .txt file with one card name per line. Repeat a line for extra copies.'
  },
  {
    id: 'ydk',
    title: 'YDK file',
    icon: '🗂',
    accept: '.ydk',
    blurb: 'A .ydk deck file. Every passcode in main, extra and side is imported.'
  }
]

function methodForFile(file) {
  const name = file.name.toLowerCase()
  if (file.type.startsWith('image/')) return 'screenshot'
  if (name.endsWith('.ydk')) return 'ydk'
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'txt'
  return null
}

function ProgressView({ progress, label }) {
  const pct =
    progress && progress.total
      ? Math.round((progress.done / progress.total) * 100)
      : null
  const text =
    progress?.stage === 'ocr'
      ? progress.total > 1
        ? `Reading card names… ${progress.done} / ${progress.total}`
        : 'Reading card names from the screenshot…'
      : progress?.stage === 'matching'
        ? `Matching cards with YGOprodeck… ${Math.floor(progress.done)} / ${progress.total}`
        : label
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-gold-400" />
      <p className="mt-6 text-sm text-white/70">{text}</p>
      {pct !== null && (
        <div className="mt-4 h-1.5 w-80 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-gold-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function ImportPage({ navigate, registerGuard }) {
  const toast = useToast()
  const [phase, setPhase] = useState('choose') // choose | working | review
  const [progress, setProgress] = useState(null)
  const [found, setFound] = useState([])
  const [unrecognized, setUnrecognized] = useState([])
  const [preview, setPreview] = useState(null)
  const [cellPreviews, setCellPreviews] = useState([])
  const [artInfo, setArtInfo] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputs = useRef({})
  const dirty = useRef(false)

  dirty.current = phase === 'review' && (found.length > 0 || unrecognized.length > 0)

  useEffect(() => {
    registerGuard(() => !dirty.current || window.confirm('Discard this import? Nothing has been added yet.'))
  }, [])

  useEffect(() => api.imports.onProgress(setProgress), [])
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])
  useEffect(() => () => cellPreviews.forEach((u) => URL.revokeObjectURL(u)), [cellPreviews])
  useEffect(() => {
    api.imports
      .artInfo()
      .then(setArtInfo)
      .catch(() => setArtInfo(null))
  }, [])

  const run = async (method, file) => {
    setPhase('working')
    setProgress(null)
    try {
      let result
      if (method === 'screenshot') {
        setPreview(URL.createObjectURL(file))
        const { previews = [], ...payload } = await prepareScreenshot(file)
        setCellPreviews(previews)
        result = await api.imports.ocr(payload)
      } else {
        const text = await file.text()
        result = method === 'ydk' ? await api.imports.ydk(text) : await api.imports.txt(text)
      }
      setFound(result.found)
      setUnrecognized(result.unrecognized)
      setPhase('review')
      if (!result.found.length && !result.unrecognized.length) {
        toast('No card names were detected. You can still add cards with the search.', 'info')
      }
    } catch (e) {
      toast(e.message, 'error')
      setPhase('choose')
    }
  }

  const handleFile = (file, expected) => {
    if (!file) return
    const method = methodForFile(file)
    if (!method || (expected && method !== expected)) {
      toast(`“${file.name}” isn’t a supported file for this import.`, 'error')
      return
    }
    run(method, file)
  }

  // Ctrl+V a screenshot straight from the clipboard.
  useEffect(() => {
    if (phase !== 'choose') return
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (item) {
        e.preventDefault()
        run('screenshot', item.getAsFile())
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [phase])

  const reset = () => {
    setFound([])
    setUnrecognized([])
    setPreview(null)
    setCellPreviews([])
    setPhase('choose')
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const items = found.filter((f) => f.quantity > 0).map((f) => ({ cardId: f.card.id, quantity: f.quantity }))
      const { added } = await api.collection.add(items)
      toast(`Added ${added} ${added === 1 ? 'card' : 'cards'} to your collection.`, 'success')
      dirty.current = false
      reset()
      navigate('collection')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'working') return <ProgressView progress={progress} label="Working…" />

  if (phase === 'review') {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-white/5 px-8 py-5">
          <h1 className="text-2xl font-bold">Review import</h1>
          <p className="text-sm text-white/40">
            Check the detected cards and quantities, add anything that was missed, then confirm.
          </p>
        </header>
        <div className="min-h-0 flex-1">
          <ReviewPanel
            found={found}
            setFound={setFound}
            unrecognized={unrecognized}
            setUnrecognized={setUnrecognized}
            preview={preview}
            cellPreviews={cellPreviews}
            onConfirm={confirm}
            onCancel={() => (!dirty.current || window.confirm('Discard this import?')) && reset()}
            busy={busy}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFile(e.dataTransfer.files[0])
      }}
    >
      <header className="border-b border-white/5 px-8 py-5">
        <h1 className="text-2xl font-bold">Import cards</h1>
        <p className="text-sm text-white/40">
          Add the cards you just opened. You’ll get to review everything before it’s added.
        </p>
      </header>

      <div className="mx-auto grid w-full max-w-5xl grid-cols-3 gap-5 px-8 pt-10">
        {METHODS.map((m) => (
          <button
            key={m.id}
            onClick={() => inputs.current[m.id]?.click()}
            className="group flex flex-col items-start rounded-2xl border border-white/10 bg-ink-850 p-6 text-left transition hover:-translate-y-0.5 hover:border-gold-400/50 hover:bg-ink-800"
          >
            <span className="text-3xl">{m.icon}</span>
            <span className="mt-4 text-lg font-semibold group-hover:text-gold-300">{m.title}</span>
            <span className="mt-2 text-sm leading-relaxed text-white/50">{m.blurb}</span>
            <input
              ref={(el) => (inputs.current[m.id] = el)}
              type="file"
              accept={m.accept}
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files[0], m.id)
                e.target.value = ''
              }}
            />
          </button>
        ))}
      </div>

      <div className="mx-auto mt-6 w-full max-w-5xl px-8">
        <button
          onClick={() => setPhase('review')}
          className="w-full rounded-2xl border border-dashed border-white/15 px-6 py-5 text-left transition hover:border-gold-400/50 hover:bg-white/[0.02]"
        >
          <span className="font-semibold">Search & add manually</span>
          <span className="ml-3 text-sm text-white/50">Look up cards by name and add them one by one.</span>
        </button>
        <p className="mt-6 text-center text-xs text-white/30">
          Tip: drag a screenshot, .txt or .ydk file anywhere onto this page.
        </p>
        {artInfo !== undefined && (
          <p className="mt-1 text-center text-xs text-white/30">
            {artInfo
              ? `Screenshots are matched by artwork (${artInfo.cards.toLocaleString()} cards, updated ${new Date(
                  artInfo.builtAt * 1000
                ).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}) and by name.`
              : 'Artwork recognition isn’t available in this build; screenshots are matched by name.'}
          </p>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-3xl border-2 border-dashed border-gold-400/70 bg-ink-950/80 text-lg font-semibold text-gold-300">
          Drop to import
        </div>
      )}
    </div>
  )
}
