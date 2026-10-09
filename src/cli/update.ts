import { spawnSync } from 'node:child_process'
import type { Command } from 'commander'
import { readBuildInfo } from '../build-info.js'
import { UserError } from '../core/types.js'
import { inspectGit, planUpdate } from '../core/update.js'
import { VERSION } from '../version.js'

function run(cmd: string, args: string[], cwd: string) {
  // On Windows npm is a .cmd script, which Node only spawns through a shell.
  const npmOnWindows = process.platform === 'win32' && cmd === 'npm'
  const result = spawnSync(npmOnWindows ? 'npm.cmd' : cmd, args, { cwd, stdio: 'inherit', shell: npmOnWindows })
  if (result.status !== 0) {
    throw new UserError(`"${cmd} ${args.join(' ')}" failed (exit code ${result.status ?? 'unknown'}). Nothing else was changed.`)
  }
}

export function registerUpdateCommand(program: Command, getInstallDir: () => string, out: (line: string) => void): void {
  program
    .command('update')
    .description('update mmp to the latest version (git installs) and rebuild it')
    .option('--check', 'only report whether an update is available')
    .action((opts: { check?: boolean }) => {
      const dir = getInstallDir()
      const plan = planUpdate(inspectGit(dir, { fetch: true }))
      if (plan.kind === 'refuse') throw new UserError(`Cannot update: ${plan.reason}`)
      if (plan.kind === 'up-to-date') return out(`mmp ${VERSION} is up to date.`)
      if (opts.check) return out(`An update is available: ${plan.commits} new commit(s). Run "mmp update" to install it.`)
      run('git', ['pull', '--ff-only'], dir)
      run('npm', ['install'], dir)
      const after = readBuildInfo(dir)?.version ?? VERSION
      out(`Updated mmp ${VERSION} → ${after} (${plan.commits} commit(s)).`)
      out('A running "mmp start" restarts by itself. Restart Claude Code sessions to use the new MCP tools.')
    })
}
