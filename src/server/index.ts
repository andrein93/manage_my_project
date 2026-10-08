import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { App } from '../core/app.js'
import { UserError } from '../core/types.js'
import { systemOpener, type Opener } from './open.js'
import { registerOrganizeRoutes } from './organize-routes.js'
import { registerRoutes } from './routes.js'
import { registerExtrasRoutes } from './extras-routes.js'
import { registerFinanceRoutes } from './finance-routes.js'
import { helpDocs } from './help.js'
import { registerSyncRoutes } from './sync-routes.js'
import { registerTimeRoutes } from './time-routes.js'

export interface ServerOptions {
  opener?: Opener
  /** Folder with the built dashboard; defaults to `<installDir>/dist/web`. */
  webDir?: string
  logger?: boolean
  /** Import time activity on start and every few minutes (default true for startServer). */
  backgroundSync?: boolean
}

const SYNC_INTERVAL_MS = 5 * 60_000
const TEAM_SYNC_INTERVAL_MS = 2 * 60_000

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const MUTATING = new Set(['POST', 'PUT', 'PATCH'])

export async function buildServer(app: App, options: ServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({ logger: options.logger ?? false })
  const allowedHosts = new Set([...LOCAL_HOSTS, ...app.config.allowedHosts])

  // Reject requests whose Host is not ours (DNS rebinding) and non-JSON writes (form CSRF).
  server.addHook('onRequest', async (request, reply) => {
    const host = (request.headers.host ?? '').toLowerCase().replace(/:\d+$/, '')
    if (!allowedHosts.has(host)) {
      return reply.code(403).send({ error: `Host "${host}" not allowed. Add it to MMP_ALLOWED_HOSTS.` })
    }
    if (MUTATING.has(request.method) && !request.headers['content-type']?.startsWith('application/json')) {
      return reply.code(415).send({ error: 'Expected application/json' })
    }
  })

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof UserError) {
      const status = { invalid: 400, not_found: 404, conflict: 409 }[error.code]
      return reply.code(status).send({ error: error.message })
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') })
    }
    const status = (error as { statusCode?: number }).statusCode
    if (status && status < 500) return reply.code(status).send({ error: (error as Error).message })
    server.log.error(error)
    return reply.code(500).send({ error: 'Internal error' })
  })

  await server.register(
    async (api) => {
      registerRoutes(api, app, options.opener ?? systemOpener)
      registerOrganizeRoutes(api, app)
      registerTimeRoutes(api, app)
      registerFinanceRoutes(api, app)
      registerExtrasRoutes(api, app)
      registerSyncRoutes(api, app)
      api.get('/help', async () => helpDocs(app))
    },
    { prefix: '/api' },
  )

  const webDir = options.webDir ?? join(app.config.installDir, 'dist', 'web')
  if (existsSync(join(webDir, 'index.html'))) {
    await server.register(fastifyStatic, { root: webDir })
    server.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'Not found' })
    })
  } else {
    server.get('/', async (_req, reply) =>
      reply.type('text/plain').send('Dashboard not built. Run `npm run build` and restart.'),
    )
  }

  return server
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

export async function startServer(app: App, options: ServerOptions = {}): Promise<{ url: string; server: FastifyInstance }> {
  // The API has no authentication and can open folders: never expose it to the network.
  if (!LOOPBACK.has(app.config.host)) {
    throw new UserError(`MMP_HOST must be a loopback address (127.0.0.1, ::1 or localhost), got "${app.config.host}".`)
  }
  const server = await buildServer(app, options)
  // Hooks must be registered before listen().
  let timer: ReturnType<typeof setInterval> | undefined
  let teamTimer: ReturnType<typeof setInterval> | undefined
  server.addHook('onClose', async () => {
    clearInterval(timer)
    clearInterval(teamTimer)
  })
  try {
    await server.listen({ port: app.config.port, host: app.config.host })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new UserError(`Port ${app.config.port} is already in use. Is mmp already running? Change MMP_PORT in .env.`)
    }
    throw error
  }
  if (options.backgroundSync !== false) {
    // Not awaited: the first import of a long history must not delay the dashboard.
    const sync = () => app.time.sync().catch((error) => server.log.error(error))
    sync()
    timer = setInterval(sync, SYNC_INTERVAL_MS)
    timer.unref()
    // Team sync only when configured; errors are kept in sync status for the dashboard.
    const teamSync = () => {
      if (app.sync.status().configured) app.sync.run().catch(() => undefined)
    }
    teamSync()
    teamTimer = setInterval(teamSync, TEAM_SYNC_INTERVAL_MS)
    teamTimer.unref()
  }
  return { url: `http://localhost:${app.config.port}`, server }
}
