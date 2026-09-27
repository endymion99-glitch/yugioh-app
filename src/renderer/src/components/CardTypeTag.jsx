import { cardCategory } from '@shared/cardTypes.js'

const STYLES = {
  monster: 'bg-amber-500/15 text-amber-300',
  extra: 'bg-violet-500/15 text-violet-300',
  spell: 'bg-emerald-500/15 text-emerald-300',
  trap: 'bg-pink-500/15 text-pink-300',
  other: 'bg-white/10 text-white/60'
}

export default function CardTypeTag({ type, className = '' }) {
  if (!type) return null
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${STYLES[cardCategory(type)]} ${className}`}
    >
      {type.replace(/ Card$/, '')}
    </span>
  )
}
