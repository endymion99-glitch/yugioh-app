import { describe, expect, it } from 'vitest'
import { commands } from '../src/commands/registry'
import { OptionType } from '../src/discord/types'

// Discord's limits for command registration. Breaking one makes `npm run register` fail.
const NAME = /^[-_\p{Ll}\p{N}]{1,32}$/u

function check(path: string, item: any, errors: string[]) {
  if (!NAME.test(item.name)) errors.push(`${path}: bad name "${item.name}"`)
  if (!item.description || item.description.length > 100) errors.push(`${path}: description must be 1-100 chars`)
  const options = item.options ?? []
  if (options.length > 25) errors.push(`${path}: more than 25 options`)
  let seenOptional = false
  for (const o of options) {
    const isSub = o.type === OptionType.SUB_COMMAND || o.type === OptionType.SUB_COMMAND_GROUP
    if (!isSub) {
      if (o.required && seenOptional) errors.push(`${path} ${o.name}: required options must come first`)
      if (!o.required) seenOptional = true
    }
    for (const c of o.choices ?? []) if (!c.name || c.name.length > 100) errors.push(`${path} ${o.name}: bad choice name`)
    check(`${path} ${o.name}`, o, errors)
  }
}

describe('slash command definitions', () => {
  it('follow Discord registration rules', () => {
    const errors: string[] = []
    for (const c of commands) check(`/${c.definition.name}`, c.definition, errors)
    expect(errors).toEqual([])
  })

  it('have unique names', () => {
    const names = commands.map((c) => c.definition.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
