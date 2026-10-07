// Small helpers for writing Discord message text.

/** Stops player names like "*bob*" from turning into Discord formatting. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>#[\]()-])/g, '\\$1')
}

export const mentionUser = (id: string) => `<@${id}>`
export const mentionRole = (id: string) => `<@&${id}>`
export const mentionChannel = (id: string) => `<#${id}>`
