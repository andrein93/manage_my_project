import type { Command } from 'commander'
import type { App } from '../core/app.js'
import { formatTable } from './format.js'

type Out = (line: string) => void

export function registerSyncCommands(program: Command, getApp: () => App, out: Out): void {
  const sync = program.command('sync').description('share projects with your team through a sync server')

  sync
    .command('run', { isDefault: true })
    .description('pull the team\'s changes and push yours (default)')
    .action(async () => {
      const r = await getApp().sync.run()
      out(`Synced in ${r.durationMs} ms: ${r.pulled} change(s) received, ${r.applied} applied, ${r.pushed} sent`)
      if (r.skipped) out(`  ${r.skipped} change(s) skipped (they refer to projects that are not shared with you)`)
    })

  sync
    .command('login <url> <token>')
    .description('connect to a team server (the admin creates your token with php artisan mmp:user)')
    .action(async (url: string, token: string) => {
      const app = getApp()
      const status = await app.sync.login(url, token)
      out(`Connected to ${status.url} as ${status.user?.name}. Mark projects as shared with: mmp set <project> --share`)
      const r = await app.sync.run()
      out(`First sync: ${r.applied} change(s) received, ${r.pushed} sent`)
    })

  sync
    .command('status')
    .description('show the team server, your identity and the last sync')
    .option('--json', 'print JSON')
    .action((o: { json?: boolean }) => {
      const s = getApp().sync.status()
      if (o.json) return out(JSON.stringify(s, null, 2))
      if (!s.configured) return out('Team sync is not configured. Run: mmp sync login <url> <token>')
      out(`Server   ${s.url}`)
      out(`You      ${s.user?.name} <${s.user?.email}>`)
      out(`Last     ${s.lastRun ? `${s.lastRun.at} (${s.lastRun.applied} received, ${s.lastRun.pushed} sent)` : 'never'}`)
      if (s.lastError) out(`Error    ${s.lastError}`)
    })

  sync
    .command('logout')
    .description('disconnect from the team server (your data stays on this computer)')
    .action(() => {
      getApp().sync.logout()
      out('Disconnected from the team server.')
    })

  program
    .command('members')
    .description('team members known from the sync server')
    .action(() => {
      const members = getApp().sync.members()
      out(formatTable(['NAME', 'ID'], members.map((m) => [m.name + (m.me ? ' (you)' : ''), m.id])))
    })
}
