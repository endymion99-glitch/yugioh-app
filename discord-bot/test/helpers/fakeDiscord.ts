// Stands in for Discord's REST API during tests: records every call the bot
// makes and answers like Discord would. Installed for every test by test/setup.ts.
export interface ApiCall {
  method: string
  path: string
  body: any
}

type Failure = { match: (call: ApiCall) => boolean; status: number; body: unknown }

class FakeDiscord {
  calls: ApiCall[] = []
  private failures: Failure[] = []
  private nextId = 1

  reset() {
    this.calls = []
    this.failures = []
    this.nextId = 1
  }

  /** Makes matching calls fail, e.g. to simulate missing channel permissions. */
  fail(match: (call: ApiCall) => boolean, status = 403, body: unknown = { code: 50001, message: 'Missing Access' }) {
    this.failures.push({ match, status, body })
  }

  /** Calls whose path contains `part` (and optionally use `method`). */
  find(part: string, method?: string) {
    return this.calls.filter((c) => c.path.includes(part) && (!method || c.method === method))
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.hostname !== 'discord.com') throw new Error(`Unexpected network call in a test: ${url}`)
    const call: ApiCall = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/api/v10', ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    }
    this.calls.push(call)
    const failure = this.failures.find((f) => f.match(call))
    if (failure) return new Response(JSON.stringify(failure.body), { status: failure.status })
    return new Response(JSON.stringify({ id: `msg-${this.nextId++}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
}

export const discord = new FakeDiscord()
