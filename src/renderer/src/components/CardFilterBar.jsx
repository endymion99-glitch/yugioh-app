import { useState } from 'react'
import { ATTRIBUTES, MONSTER_KINDS, MONSTER_RACES } from '@shared/cardTypes.js'
import {
  EMPTY_FILTERS,
  SORTS,
  hasLevelFilters,
  hasMonsterFilters,
  isFiltering,
  resetFilters,
  updateFilters
} from '@shared/cardFilters.js'
import LevelPicker from './LevelPicker.jsx'

/** Filter and sort state for a card list. */
export function useCardFilters(defaultSort) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState(defaultSort)
  return {
    filters,
    sort,
    setSort,
    update: (patch) => setFilters((f) => updateFilters(f, patch)),
    reset: () => setFilters(resetFilters)
  }
}

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'monster', label: 'Monsters' },
  { id: 'extra', label: 'Extra' },
  { id: 'spell', label: 'Spells' },
  { id: 'trap', label: 'Traps' }
]

const control = (active) =>
  `rounded-md border bg-ink-950/70 px-2 py-1 text-xs outline-none focus:border-gold-400/60 ${active ? 'border-gold-400/60 text-white' : 'border-white/10 text-white/60'}`

/**
 * Search box, sort menu, tabs and monster filters. `wide` lays everything
 * out in one wrapping toolbar; otherwise it stacks in rows for a side panel.
 * `hint` is a line of help text, followed by the reset link.
 */
export default function CardFilterBar({ state, counts, sorts, wide = false, placeholder = 'Search your collection…', hint }) {
  const { filters: f, update, reset, sort, setSort } = state
  const row = (extra = '') => (wide ? 'contents' : `flex items-center gap-2 ${extra}`)
  const extraTab = f.category === 'extra'

  return (
    <div className={wide ? 'flex flex-wrap items-center gap-3' : 'space-y-2'}>
      <div className={row()}>
        <input
          value={f.query}
          onChange={(e) => update({ query: e.target.value })}
          placeholder={placeholder}
          className={`${wide ? 'w-72' : 'min-w-0 flex-1'} rounded-lg border border-white/10 bg-ink-950/70 px-4 py-2 text-sm outline-none placeholder:text-white/30 focus:border-gold-400/60`}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-white/10 bg-ink-950/70 px-2 py-2 text-xs text-white/80 outline-none focus:border-gold-400/60"
        >
          {sorts.map((id) => (
            <option key={id} value={id}>
              {SORTS[id].label}
            </option>
          ))}
        </select>
      </div>

      <div className={row('gap-1')}>
        <div className="flex items-center gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => update({ category: t.id })}
              className={`rounded-md px-2.5 py-1 text-xs ${f.category === t.id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={f.kind}
          onChange={(e) => update({ kind: e.target.value })}
          className={`${wide ? '' : 'ml-auto'} ${control(f.kind)}`}
        >
          <option value="">Any monster kind</option>
          {MONSTER_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label} monsters
            </option>
          ))}
        </select>
      </div>

      {hasMonsterFilters(f.category) && (
        <div className={row('flex-wrap')}>
          <select value={f.attribute} onChange={(e) => update({ attribute: e.target.value })} className={control(f.attribute)}>
            <option value="">Attribute: any</option>
            {ATTRIBUTES.map((a) => (
              <option key={a} value={a}>
                {a} ({counts.attribute.get(a) || 0})
              </option>
            ))}
          </select>
          <select value={f.race} onChange={(e) => update({ race: e.target.value })} className={control(f.race)}>
            <option value="">Type: any</option>
            {MONSTER_RACES.map((r) => (
              <option key={r} value={r}>
                {r} ({counts.race.get(r) || 0})
              </option>
            ))}
          </select>
          {hasLevelFilters(f.category) && (
            <>
              <select value={f.levelSort} onChange={(e) => update({ levelSort: e.target.value })} className={control(f.levelSort)}>
                <option value="">{extraTab ? 'Level/Rank order: off' : 'Level order: off'}</option>
                <option value="desc">{extraTab ? 'Level/Rank: high → low' : 'Level: high → low'}</option>
                <option value="asc">{extraTab ? 'Level/Rank: low → high' : 'Level: low → high'}</option>
              </select>
              <LevelPicker
                selected={f.levels}
                onChange={(levels) => update({ levels })}
                counts={counts.level}
                withRanks={extraTab}
              />
            </>
          )}
        </div>
      )}

      {(hint || isFiltering(f)) && (
        <div className={row('justify-between')}>
          {hint && <p className="text-[11px] text-white/35">{hint}</p>}
          {isFiltering(f) && (
            <button onClick={reset} className="text-xs whitespace-nowrap text-gold-300 hover:underline">
              Reset filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Shown in place of the grid when the filters hide every card. */
export function NoMatches({ onReset }) {
  return (
    <div className="mt-12 text-center text-sm text-white/45">
      No cards match these filters.
      <div>
        <button onClick={onReset} className="mt-3 rounded-lg border border-white/10 px-4 py-1.5 text-white/80 hover:bg-white/5">
          Reset filters
        </button>
      </div>
    </div>
  )
}
