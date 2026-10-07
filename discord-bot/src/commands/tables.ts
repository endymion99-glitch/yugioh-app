// /points set and /rewards set: the editable points and rewards tables.
import { getConfig } from '../db/config'
import { getPointsTable, getRewardsTable, setPoints, setReward } from '../db/standings'
import { parseCommand } from '../discord/options'
import { requireAdmin, requireGuild } from '../discord/permissions'
import { ephemeral } from '../discord/responses'
import { OptionType } from '../discord/types'
import { TournamentError } from '../logic/errors'
import { describeReward } from '../logic/points'
import { ordinal } from '../views/summary'
import type { Command } from './registry'

const placeOption = {
  type: OptionType.INTEGER,
  name: 'place',
  description: 'Which place (1-8)',
  required: true,
  min_value: 1,
  max_value: 8
}

const count = (name: string, description: string, required = false) => ({
  type: OptionType.INTEGER,
  name,
  description,
  required,
  min_value: 0,
  max_value: 1000
})

function placeOf(value: unknown): number {
  const place = Number(value)
  if (!Number.isInteger(place) || place < 1 || place > 8) throw new TournamentError('Place must be between 1 and 8.')
  return place
}

export const points: Command = {
  definition: {
    name: 'points',
    description: 'The points awarded per place (admins only)',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'set',
        description: 'Change the points for a place (updates everyone’s totals)',
        options: [placeOption, count('points', 'Points for that place', true)]
      }
    ]
  },
  async handle({ interaction, env }) {
    requireGuild(interaction)
    requireAdmin(interaction, await getConfig(env.DB, 'admin_role_id'))
    const { options } = parseCommand(interaction)
    const place = placeOf(options.place)
    const value = Number(options.points)
    if (!Number.isInteger(value) || value < 0) throw new TournamentError('Points must be 0 or more.')
    await setPoints(env.DB, place, value)
    const table = await getPointsTable(env.DB)
    const rows = [...table].map(([p, pts]) => `${ordinal(p)}: **${pts}**`).join(' · ')
    return ephemeral(
      `Done. ${ordinal(place)} place is now worth **${value} points**. Totals and standings for every tournament use the new table.\n${rows}`
    )
  }
}

export const rewards: Command = {
  definition: {
    name: 'rewards',
    description: 'The rewards per place (admins only)',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'set',
        description: 'Change the reward for a place (leave a box empty to keep it)',
        options: [
          placeOption,
          count('base_packs', 'Packs everyone gets (default 10)'),
          count('extra_packs', 'Additional packs for this place'),
          count('chosen_cards', 'Cards of their choice for this place')
        ]
      }
    ]
  },
  async handle({ interaction, env }) {
    requireGuild(interaction)
    requireAdmin(interaction, await getConfig(env.DB, 'admin_role_id'))
    const { options } = parseCommand(interaction)
    const place = placeOf(options.place)
    if (options.base_packs === undefined && options.extra_packs === undefined && options.chosen_cards === undefined) {
      throw new TournamentError('Fill in at least one of base_packs, extra_packs or chosen_cards.')
    }
    const current = (await getRewardsTable(env.DB)).find((r) => r.place === place) ?? {
      place,
      base_packs: 0,
      extra_packs: 0,
      chosen_cards: 0
    }
    const pick = (key: 'base_packs' | 'extra_packs' | 'chosen_cards') => {
      const v = options[key] === undefined ? current[key] : Number(options[key])
      if (!Number.isInteger(v) || v < 0) throw new TournamentError(`${key} must be 0 or more.`)
      return v
    }
    const row = { place, base_packs: pick('base_packs'), extra_packs: pick('extra_packs'), chosen_cards: pick('chosen_cards') }
    await setReward(env.DB, row)
    const table = (await getRewardsTable(env.DB)).map((r) => `${ordinal(r.place)}: ${describeReward(r).text}`).join('\n')
    return ephemeral(`Done. ${ordinal(place)} place now gets: **${describeReward(row).text}**.\n\n${table}`)
  }
}
