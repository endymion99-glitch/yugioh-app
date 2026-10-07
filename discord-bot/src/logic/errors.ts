/**
 * A problem caused by the request rather than a bug, such as reporting a
 * match you aren't in. The message is written for players and is shown to
 * them as-is.
 */
export class TournamentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TournamentError'
  }
}
