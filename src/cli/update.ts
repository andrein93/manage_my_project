import { spawnSync } from 'node:child_process'
import type { Command } from 'commander'
import { readBuildInfo } from '../build-info.js'
import { UserError } from '../core/types.js'
import { buildIsStale, inspectGit, planUpdate } from '../core/update.js'
import { VERSION } from '../version.js'

/** Runs a step; on failure throws with a message that says what state the install is left in. */
function run(cmd: string, args: string[], cwd: string, onFailure: (code: string) => string) {
  // On Windows npm is a .cmd script, which Node only spawns through a shell.
  const npmOnWindows = process.platform === 'win32' && cmd === 'npm'
  const result = spawnSync(npmOnWindows ? 'npm.cmd' : cmd, args, { cwd, stdio: 'inherit', shell: npmOnWindows })
  if (result.status !== 0) throw new UserError(onFailure(String(result.status ?? 'unknown')))
}

const rebuildFailed = (dir: string, what: string) => (code: string) =>
  `${what} (exit code ${code}). The running server keeps the previous build; fix the error and run "mmp update" again, or "npm install" in ${dir}.`

export function registerUpdateCommand(program: Command, getInstallDir: () => string, out: (line: string) => void): void {
  program
    .command('update')
    .description('update mmp to the latest version (git installs) and rebuild it')
    .option('--check', 'only report whether an update is available')
    .action((opts: { check?: boolean }) => {
      const dir = getInstallDir()
      const git = inspectGit(dir, { fetch: true })
      const plan = planUpdate(git, { stale: buildIsStale(readBuildInfo(dir), VERSION, git.headTime ?? null) })
      if (plan.kind === 'refuse') throw new UserError(`Cannot update: ${plan.reason}`)
      if (plan.kind === 'up-to-date') return out(`mmp ${VERSION} is up to date.`)
      if (plan.kind === 'rebuild') {
        if (opts.check) return out('The code is up to date but the installed build is older. Run "mmp update" to rebuild it.')
        run('npm', ['install'], dir, rebuildFailed(dir, 'The rebuild failed'))
        return out(`Rebuilt mmp ${VERSION}. A running "mmp start" restarts by itself.`)
      }
      if (opts.check) return out(`An update is available: ${plan.commits} new commit(s). Run "mmp update" to install it.`)
      run('git', ['pull', '--ff-only'], dir, (code) => `"git pull --ff-only" failed (exit code ${code}). Nothing was changed.`)
      run('npm', ['install'], dir, rebuildFailed(dir, 'The code was updated but the rebuild failed'))
      const after = readBuildInfo(dir)?.version ?? VERSION
      out(`Updated mmp ${VERSION} → ${after} (${plan.commits} commit(s)).`)
      out('A running "mmp start" restarts by itself. Restart Claude Code sessions to use the new MCP tools.')
    })
}
