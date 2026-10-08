import { Command, InvalidArgumentError, Option } from 'commander'
import { createApp, type App } from '../core/app.js'
import { PROJECT_STATUSES, UserError, type Project, type ProjectFilters, type ProjectStatus } from '../core/types.js'
import { resolveCategoryFilter, resolveCategoryPatch, resolveClientFilter, resolveClientPatch } from '../core/filters.js'
import { VERSION } from '../version.js'
import { formatProject, formatTable, relativeTime } from './format.js'
import { registerOrganizeCommands } from './organize.js'
import { registerExtrasCommands } from './extras.js'
import { registerFinanceCommands } from './finance.js'
import { registerTimeCommands } from './time.js'


interface ListOptions {
  status?: ProjectStatus
  stack?: string
  tag?: string
  inactive?: number
  query?: string
  client?: string
  category?: string
  attention?: boolean
  framework?: string
  all?: boolean
  json?: boolean
}

interface SetOptions {
  name?: string
  description?: string
  status?: ProjectStatus
  client?: string
  category?: string
}

/** Builds the CLI. `getApp` is lazy so `--help` works without touching the database. */
export function buildCli(getApp: () => App, out: (line: string) => void = console.log): Command {
  const program = new Command('mmp')
    .description('Manage all your projects from one place: CLI, web dashboard and MCP server.')
    .version(VERSION)
    .showHelpAfterError()

  const statusOption = () =>
    new Option('--status <status>', 'filter by status').choices([...PROJECT_STATUSES])

  program
    .command('start')
    .description('start the web dashboard (scans first)')
    .option('--no-open', 'do not open the browser')
    .action(async (opts: { open: boolean }) => {
      const app = getApp()
      const { startServer } = await import('../server/index.js')
      const result = await app.scan()
      out(`Scanned ${result.total} projects in ${result.durationMs} ms`)
      const { url } = await startServer(app)
      out(`Dashboard running at ${url}  (Ctrl+C to stop)`)
      if (opts.open && app.config.openBrowser) {
        const { openUrl } = await import('../server/open.js')
        openUrl(url)
      }
    })

  program
    .command('scan')
    .description('scan workspaces and refresh every project')
    .option('--json', 'print JSON')
    .action(async (opts: { json?: boolean }) => {
      const result = await getApp().scan()
      if (opts.json) return out(JSON.stringify(result, null, 2))
      out(
        `Scanned ${result.total} projects in ${result.durationMs} ms: ` +
          `${result.added} added, ${result.updated} updated, ${result.restored} restored, ${result.missing} missing`,
      )
      for (const e of result.errors) out(`  ! ${e.path}: ${e.message}`)
    })

  program
    .command('list')
    .alias('ls')
    .description('list projects (archived and ignored are hidden unless --all or --status)')
    .addOption(statusOption())
    .option('--stack <stack>', 'filter by stack, e.g. laravel')
    .option('--tag <tag>', 'filter by tag')
    .option('--inactive <days>', 'only projects with no activity in the last N days', parsePositiveInt)
    .option('-q, --query <text>', 'search name, description, path, tags, client and category')
    .option('--client <ref>', 'filter by client (name or id), or "none"')
    .option('--category <ref>', 'filter by category (name or id), or "none"')
    .option('--attention', 'only projects that need attention (see mmp health)')
    .option('--framework <framework@major>', 'e.g. laravel@9 or vue@2')
    .option('-a, --all', 'include archived and ignored projects')
    .option('--json', 'print JSON')
    .action((opts: ListOptions) => {
      const app = getApp()
      const filters: ProjectFilters = {
        status: opts.status ? [opts.status] : undefined,
        stack: opts.stack,
        tag: opts.tag,
        inactiveDays: opts.inactive,
        query: opts.query,
        client: resolveClientFilter(app, opts.client),
        category: resolveCategoryFilter(app, opts.category),
        attention: opts.attention,
        version: opts.framework,
        all: opts.all,
      }
      const projects = app.projects.list(filters)
      if (opts.json) return out(JSON.stringify(projects, null, 2))
      if (projects.length === 0) return out('No projects found.')
      out(
        formatTable(
          ['NAME', 'STATUS', 'CLIENT', 'CATEGORY', 'STACK', 'ACTIVITY', 'PATH'],
          projects.map((p) => [
            p.name + (p.missingSince ? ' (missing)' : ''),
            p.status,
            p.client?.name ?? '-',
            p.category?.name ?? '-',
            p.stack.join(',') || '-',
            relativeTime(p.lastActivityAt),
            p.path,
          ]),
        ),
      )
      out(`\n${projects.length} project(s)`)
    })

  program
    .command('show <ref>')
    .description('show a project (ref = id, path or name)')
    .option('--json', 'print JSON')
    .action((ref: string, opts: { json?: boolean }) => {
      const project = getApp().projects.resolve(ref)
      out(opts.json ? JSON.stringify(project, null, 2) : formatProject(project))
    })

  program
    .command('add <path>')
    .description('register a single folder as a project')
    .action(async (path: string) => {
      const project = await getApp().addProject(path)
      out(`Added "${project.name}" (${project.id})`)
    })

  const workspace = program.command('workspace').alias('ws').description('manage folders that are scanned for projects')
  workspace
    .command('list')
    .description('list workspaces')
    .action(() => {
      const list = getApp().workspaces.list()
      out(list.length ? formatTable(['ID', 'PATH'], list.map((w) => [w.id, w.path])) : 'No workspaces.')
    })
  workspace
    .command('add <path>')
    .description('add a workspace and scan it')
    .action(async (path: string) => {
      const app = getApp()
      const ws = app.workspaces.add(path)
      const result = await app.scan()
      out(`Workspace added: ${ws.path} (${result.added} new project(s))`)
    })
  workspace
    .command('remove <ref>')
    .description('remove a workspace by id or path (its scanned projects are hidden)')
    .action((ref: string) => {
      const ws = getApp().workspaces.remove(ref)
      out(`Workspace removed: ${ws.path}`)
    })

  program
    .command('set <ref>')
    .description('edit name, description, status, client or category of a project')
    .option('--name <name>')
    .option('--description <text>')
    .addOption(new Option('--status <status>').choices([...PROJECT_STATUSES]))
    .option('--client <ref>', 'client name or id, or "none" to clear')
    .option('--category <ref>', 'category name or id, or "none" to clear')
    .action((ref: string, opts: SetOptions) => {
      const app = getApp()
      const project = app.projects.update(app.projects.resolve(ref).id, {
        name: opts.name,
        description: opts.description,
        status: opts.status,
        clientId: resolveClientPatch(app, opts.client),
        categoryId: resolveCategoryPatch(app, opts.category),
      })
      out(formatProject(project))
    })

  program
    .command('tag <ref>')
    .description('add or remove tags')
    .option('--add <tags...>', 'tags to add')
    .option('--remove <tags...>', 'tags to remove')
    .action((ref: string, opts: { add?: string[]; remove?: string[] }) => {
      const app = getApp()
      const project: Project = app.projects.editTags(app.projects.resolve(ref).id, opts.add, opts.remove)
      out(`${project.name}: ${project.tags.join(', ') || '(no tags)'}`)
    })

  registerOrganizeCommands(program, getApp, out)
  registerTimeCommands(program, getApp, out)
  registerFinanceCommands(program, getApp, out)
  registerExtrasCommands(program, getApp, out)

  program
    .command('mcp')
    .description('run the MCP server on stdio (started by your AI assistant)')
    .action(async () => {
      const { startMcpServer } = await import('../mcp/index.js')
      await startMcpServer(getApp())
    })

  return program
}

export async function run(argv: string[]): Promise<void> {
  let app: App | undefined
  const program = buildCli(() => (app ??= createApp()))
  try {
    await program.parseAsync(argv)
  } catch (error) {
    if (error instanceof UserError) {
      console.error(`Error: ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }
}

function parsePositiveInt(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError('Expected a non-negative integer.')
  return n
}
