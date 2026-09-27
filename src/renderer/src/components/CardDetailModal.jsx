import Modal from './Modal.jsx'
import CardImage from './CardImage.jsx'
import CardTypeTag from './CardTypeTag.jsx'
import QuantityStepper from './QuantityStepper.jsx'

function Stat({ label, value }) {
  if (value === null || value === undefined) return null
  return (
    <div className="rounded-lg bg-ink-950/60 px-3 py-2">
      <div className="text-[10px] tracking-wider text-white/40 uppercase">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

/**
 * Large card view. Pass `quantity` + `onQuantityChange` to allow editing how
 * many copies are in the collection.
 */
export default function CardDetailModal({ card, quantity, onQuantityChange, onClose }) {
  const isLink = card.linkval !== null && card.linkval !== undefined
  return (
    <Modal onClose={onClose} className="w-[min(960px,100%)]">
      <div className="flex gap-8 p-8">
        <div className="w-[340px] shrink-0">
          <CardImage cardId={card.id} alt={card.name} className="shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9)]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-2xl leading-tight font-bold text-white">{card.name}</h2>
            <button onClick={onClose} className="text-2xl leading-none text-white/40 hover:text-white">
              ×
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/60">
            <CardTypeTag type={card.type} />
            {card.attribute && <span>{card.attribute}</span>}
            {card.race && <span>· {card.race}</span>}
            <span className="text-white/30">· #{card.id}</span>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            <Stat label={isLink ? 'Link' : 'Level'} value={isLink ? card.linkval : card.level} />
            <Stat label="ATK" value={card.atk} />
            {!isLink && <Stat label="DEF" value={card.def} />}
          </div>

          <p className="mt-5 flex-1 overflow-auto rounded-lg bg-ink-950/40 p-4 text-sm leading-relaxed whitespace-pre-line text-white/80 select-text">
            {card.desc || 'No description cached.'}
          </p>

          {onQuantityChange && (
            <div className="mt-5 flex items-center justify-between rounded-lg border border-white/10 bg-ink-900 px-4 py-3">
              <span className="text-sm text-white/70">Copies in collection</span>
              <div className="flex items-center gap-3">
                <QuantityStepper value={quantity} onChange={onQuantityChange} min={0} />
                {quantity === 0 && <span className="text-xs text-rose-300">Will be removed</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
