// Last step of `npm run build`: marks a complete build. A running `mmp start` restarts when this changes.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const builtAt = new Date().toISOString()
const id = `${builtAt}-${Math.random().toString(36).slice(2, 6)}`
writeFileSync(new URL('dist/build.json', root), JSON.stringify({ id, version, builtAt }, null, 2) + '\n')
console.log(`Build ${id} (v${version})`)
