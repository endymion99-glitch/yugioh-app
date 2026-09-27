import { useState } from 'react'

// Card art served by the main process's caching ygo-img:// protocol.
export default function CardImage({ cardId, size = 'card', alt = '', className = '' }) {
  const [failed, setFailed] = useState(false)
  if (failed || !cardId) {
    return (
      <div
        className={`flex aspect-[421/614] items-center justify-center rounded-md bg-gradient-to-br from-ink-700 to-ink-800 p-2 text-center text-[10px] text-white/40 ${className}`}
      >
        {alt || 'No image'}
      </div>
    )
  }
  return (
    <img
      src={`ygo-img://${size}/${cardId}`}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={`aspect-[421/614] w-full rounded-md bg-ink-800 object-cover ${className}`}
    />
  )
}
