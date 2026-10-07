import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

export interface Config {
  port: number
  host: string
  dataDir: string
  openBrowser: boolean
  allowedHosts: string[]
  /** Folder where mmp itself is installed (repo root). */
  installDir: string
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv
  /** Path of the .env file; defaults to `<installDir>/.env`. */
  envFile?: string
  installDir?: string
}

export const DEFAULT_INSTALL_DIR = fileURLToPath(new URL('..', import.meta.url))

/** Resolves configuration: process env > .env file > defaults. */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const installDir = resolve(options.installDir ?? DEFAULT_INSTALL_DIR)
  const envFile = options.envFile ?? join(installDir, '.env')
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}
  const env = { ...fromFile, ...(options.env ?? process.env) }

  const port = Number(env.MMP_PORT ?? 4477)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MMP_PORT: ${env.MMP_PORT}`)
  }

  return {
    port,
    host: env.MMP_HOST || '127.0.0.1',
    dataDir: resolve(env.MMP_DATA_DIR || join(homedir(), '.manage-my-projects')),
    openBrowser: !['false', '0', 'no'].includes(String(env.MMP_OPEN_BROWSER ?? 'true').toLowerCase()),
    allowedHosts: (env.MMP_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    installDir,
  }
}
