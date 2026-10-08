import { Option, type Command } from 'commander'
import type { App } from '../core/app.js'
import { resolveCategoryFilter, resolveClientFilter } from '../core/filters.js'
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
} from '../core/types.js'
import { formatTable } from './format.js'

type Out = (line: string) => void

const short = (id: string) => id.slice(0, 8)

export function formatTasks(tasks: Task[]): string {
  return formatTable(
    ['ID', 'STATUS', 'PRIORITY', 'DUE', 'PROJECT', 'TITLE'],
    tasks.map((t) => [
      short(t.id),
      t.status,
      t.priority,
      (t.dueDate ?? '-') + (t.dueGroup === 'overdue' ? ' !' : ''),
      t.project.name,
      t.title,
    ]),
  )
}

function formatTask(t: Task): string {
  const rows: [string, string][] = [
    ['Title', t.title],
    ['ID', t.id],
    ['Project', t.project.name + (t.client ? ` (${t.client.name})` : '')],
    ['Status', t.status + (t.completedAt ? ` on ${t.completedAt.slice(0, 10)}` : '')],
    ['Priority', t.priority],
    ['Due', t.dueDate ?? '-'],
  ]
  if (t.description) rows.push(['Notes', t.description])
  return rows.map(([k, v]) => `${k.padEnd(9)} ${v}`).join('\n')
}

export function registerOrganizeCommands(program: Command, getApp: () => App, out: Out): void {
  // Clients
  const client = program.command('client').description('manage clients')
  client
    .command('list')
    .description('list clients')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) => {
      const list = getApp().clients.list()
      if (opts.json) return out(JSON.stringify(list, null, 2))
      if (list.length === 0) return out('No clients yet. Add one with: mmp client add "<name>"')
      out(
        formatTable(
          ['ID', 'NAME', 'PROJECTS', 'OPEN TASKS', 'EMAIL'],
          list.map((c) => [short(c.id), c.name, String(c.projectCount), String(c.openTaskCount), c.email || '-']),
        ),
      )
    })
  client
    .command('add <name>')
    .description('create a client')
    .option('--email <email>')
    .option('--notes <text>')
    .action((name: string, opts: { email?: string; notes?: string }) => {
      const created = getApp().clients.create({ name, ...opts })
      out(`Client added: ${created.name} (${short(created.id)})`)
    })
  client
    .command('show <ref>')
    .description('show a client and its projects')
    .action((ref: string) => {
      const app = getApp()
      const c = app.clients.resolve(ref)
      const projects = app.projects.list({ client: c.id, all: true })
      out(`${c.name}  (${c.id})`)
      if (c.email) out(`Email     ${c.email}`)
      if (c.notes) out(`Notes     ${c.notes}`)
      out(`Projects  ${projects.map((p) => p.name).join(', ') || '-'}`)
      out(`Open tasks ${c.openTaskCount}`)
    })
  client
    .command('edit <ref>')
    .description('edit a client')
    .option('--name <name>')
    .option('--email <email>')
    .option('--notes <text>')
    .action((ref: string, opts: { name?: string; email?: string; notes?: string }) => {
      const app = getApp()
      const updated = app.clients.update(app.clients.resolve(ref).id, opts)
      out(`Client updated: ${updated.name}`)
    })
  client
    .command('remove <ref>')
    .description('remove a client (its projects keep existing, without a client)')
    .action((ref: string) => {
      const app = getApp()
      const removed = app.clients.remove(app.clients.resolve(ref).id)
      out(`Client removed: ${removed.name}`)
    })

  // Categories
  const category = program.command('category').description('manage project categories')
  category
    .command('list')
    .description('list categories')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) => {
      const list = getApp().categories.list()
      if (opts.json) return out(JSON.stringify(list, null, 2))
      out(formatTable(['ID', 'NAME', 'COLOR', 'PROJECTS'], list.map((c) => [short(c.id), c.name, c.color, String(c.projectCount)])))
    })
  category
    .command('add <name>')
    .description('create a category')
    .option('--color <hex>', 'e.g. #4f56d6')
    .action((name: string, opts: { color?: string }) => {
      const created = getApp().categories.create({ name, color: opts.color })
      out(`Category added: ${created.name} (${created.color})`)
    })
  category
    .command('edit <ref>')
    .description('rename or recolor a category')
    .option('--name <name>')
    .option('--color <hex>')
    .action((ref: string, opts: { name?: string; color?: string }) => {
      const app = getApp()
      const updated = app.categories.update(app.categories.resolve(ref).id, opts)
      out(`Category updated: ${updated.name} (${updated.color})`)
    })
  category
    .command('remove <ref>')
    .description('remove a category (its projects become uncategorized)')
    .action((ref: string) => {
      const app = getApp()
      const removed = app.categories.remove(app.categories.resolve(ref).id)
      out(`Category removed: ${removed.name}`)
    })

  // Tasks
  const task = program.command('task').description('manage tasks')
  task
    .command('list')
    .alias('ls')
    .description('list open tasks across projects (sorted by due date, then priority)')
    .option('--project <ref>', 'project id, path or name')
    .option('--client <ref>', 'client name or id, or "none"')
    .option('--category <ref>', 'category name or id, or "none"')
    .addOption(new Option('--status <status...>', 'statuses to include (default: todo in_progress)').choices([...TASK_STATUSES]))
    .addOption(new Option('--priority <priority...>').choices([...TASK_PRIORITIES]))
    .addOption(
      new Option('--due <when>', 'overdue = before today, today = today or earlier, week = within 7 days').choices([
        'overdue',
        'today',
        'week',
      ]),
    )
    .option('-a, --all', 'include tasks of archived and ignored projects')
    .option('--json', 'print JSON')
    .action(
      (opts: {
        project?: string
        client?: string
        category?: string
        status?: TaskStatus[]
        priority?: TaskPriority[]
        due?: 'overdue' | 'today' | 'week'
        all?: boolean
        json?: boolean
      }) => {
        const app = getApp()
        const tasks = app.tasks.list({
          projectId: opts.project ? app.projects.resolve(opts.project).id : undefined,
          clientId: resolveClientFilter(app, opts.client),
          categoryId: resolveCategoryFilter(app, opts.category),
          status: opts.status,
          priority: opts.priority,
          due: opts.due,
          all: opts.all,
        })
        if (opts.json) return out(JSON.stringify(tasks, null, 2))
        if (tasks.length === 0) return out('No tasks found.')
        out(formatTasks(tasks))
        out(`\n${tasks.length} task(s)`)
      },
    )
  task
    .command('add <title>')
    .description('add a task to a project')
    .requiredOption('-p, --project <ref>', 'project id, path or name')
    .addOption(new Option('--priority <priority>').choices([...TASK_PRIORITIES]))
    .option('--due <date>', 'YYYY-MM-DD')
    .option('--description <text>')
    .action((title: string, opts: { project: string; priority?: TaskPriority; due?: string; description?: string }) => {
      const app = getApp()
      const [created] = app.tasks.create(app.projects.resolve(opts.project).id, [
        { title, priority: opts.priority, dueDate: opts.due, description: opts.description },
      ])
      out(`Task added: ${short(created.id)}  ${created.title}  (${created.project.name})`)
    })
  task
    .command('show <ref>')
    .description('show a task')
    .action((ref: string) => out(formatTask(getApp().tasks.resolve(ref))))
  task
    .command('edit <ref>')
    .description('edit a task')
    .option('--title <title>')
    .addOption(new Option('--status <status>').choices([...TASK_STATUSES]))
    .addOption(new Option('--priority <priority>').choices([...TASK_PRIORITIES]))
    .option('--due <date>', 'YYYY-MM-DD, or "none" to clear')
    .option('--description <text>')
    .action((ref: string, opts: { title?: string; status?: TaskStatus; priority?: TaskPriority; due?: string; description?: string }) => {
      const app = getApp()
      const input: TaskInput = {
        title: opts.title,
        status: opts.status,
        priority: opts.priority,
        description: opts.description,
        dueDate: opts.due === undefined ? undefined : opts.due.toLowerCase() === 'none' ? null : opts.due,
      }
      out(formatTask(app.tasks.update(app.tasks.resolve(ref).id, input)))
    })
  task
    .command('done <ref>')
    .description('mark a task as done')
    .action((ref: string) => {
      const app = getApp()
      const done = app.tasks.update(app.tasks.resolve(ref).id, { status: 'done' })
      out(`Done: ${done.title}`)
    })
  task
    .command('remove <ref>')
    .description('delete a task')
    .action((ref: string) => {
      const app = getApp()
      const removed = app.tasks.remove(app.tasks.resolve(ref).id)
      out(`Task removed: ${removed.title}`)
    })
}
