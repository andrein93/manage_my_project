import { randomUUID } from 'node:crypto'

interface StoredRecord {
  table: string
  id: string
  data: unknown
  updated_at: string
  deleted_at: string | null
  author_id: string
  seq: number
}

/**
 * In-memory implementation of the sync server protocol (see sync-server/), exposed as a
 * `fetch` function so tests exercise the real client without a network.
 */
export function createFakeSyncServer(baseUrl = 'https://team.test') {
  const users = new Map<string, { id: string; name: string; email: string }>()
  const tokens = new Map<string, string>() // token → user id
  const records = new Map<string, StoredRecord>() // `${table}:${id}`
  let seq = 0
  let calls = 0

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls++
    const url = new URL(String(input))
    if (!url.href.startsWith(baseUrl)) throw new TypeError('fetch failed')
    const auth = new Headers(init?.headers).get('authorization') ?? ''
    const userId = tokens.get(auth.replace(/^Bearer /, ''))
    if (!userId) return json(401, { message: 'Unauthenticated.' })
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = init?.method ?? 'GET'

    if (method === 'GET' && path === '/me') return json(200, { user: users.get(userId), server: { name: 'Fake', version: '1' } })
    if (method === 'GET' && path === '/members') {
      return json(200, [...users.values()].map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)))
    }
    if (method === 'POST' && path === '/sync/push') {
      const { changes } = JSON.parse(String(init?.body)) as { changes: Omit<StoredRecord, 'seq' | 'author_id'>[] }
      const accepted: string[] = []
      const ignored: string[] = []
      for (const c of changes) {
        const key = `${c.table}:${c.id}`
        const stored = records.get(key)
        if (stored && stored.updated_at >= c.updated_at) {
          ignored.push(c.id)
          continue
        }
        records.set(key, { ...c, author_id: userId, seq: ++seq })
        accepted.push(c.id)
      }
      return json(200, { accepted, ignored })
    }
    if (method === 'GET' && path === '/sync/pull') {
      const since = Number(url.searchParams.get('since') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 500)
      const newer = [...records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq)
      const page = newer.slice(0, limit)
      return json(200, { changes: page, cursor: page.at(-1)?.seq ?? since, more: newer.length > limit })
    }
    return json(404, { message: 'Not found' })
  }) as typeof fetch

  return {
    url: baseUrl,
    fetch: fetchImpl,
    records,
    callCount: () => calls,
    addUser(name: string, email: string): string {
      const id = randomUUID()
      users.set(id, { id, name, email })
      const token = randomUUID()
      tokens.set(token, id)
      return token
    },
  }
}
