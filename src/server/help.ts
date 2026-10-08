import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Command } from 'commander'
import { buildCli } from '../cli/index.js'
import type { App } from '../core/app.js'
import { createMcpServer } from '../mcp/index.js'

export interface CommandDoc {
  /** Top-level command group, e.g. "task". */
  group: string
  groupDescription: string
  /** Full command, e.g. "mmp task add". */
  command: string
  usage: string
  description: string
  options: { flags: string; description: string; choices: string[] | null; default: string | null }[]
}

export interface ToolDoc {
  name: string
  title: string | null
  description: string
  params: { name: string; type: string; description: string; required: boolean }[]
}

export interface HelpDocs {
  cli: CommandDoc[]
  mcp: ToolDoc[]
}

let cached: HelpDocs | undefined

/** Documentation generated from the real CLI and MCP definitions, so it never drifts. */
export async function helpDocs(app: App): Promise<HelpDocs> {
  return (cached ??= { cli: cliDocs(), mcp: await mcpDocs(app) })
}

function cliDocs(): CommandDoc[] {
  // The app is never touched while describing commands.
  const program = buildCli(() => {
    throw new Error('not used')
  })
  const docs: CommandDoc[] = []
  const visit = (cmd: Command, path: string[], group: Command | null) => {
    const full = [...path, cmd.name()]
    if (cmd.commands.length) {
      for (const sub of cmd.commands) visit(sub, full, group ?? (path.length ? cmd : null))
      return
    }
    const top = group ?? cmd
    docs.push({
      group: top.name(),
      groupDescription: top.description(),
      command: full.join(' '),
      usage: `${full.join(' ')} ${cmd.usage()}`.trim(),
      description: cmd.description(),
      options: cmd.options
        .filter((o) => !o.hidden)
        .map((o) => ({
          flags: o.flags,
          description: o.description,
          choices: o.argChoices ? [...o.argChoices] : null,
          default: o.defaultValue === undefined || typeof o.defaultValue === 'boolean' ? null : String(o.defaultValue),
        })),
    })
  }
  for (const cmd of program.commands) visit(cmd, [program.name()], null)
  return docs
}

async function mcpDocs(app: App): Promise<ToolDoc[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer(app)
  await server.connect(serverTransport)
  const client = new Client({ name: 'mmp-help', version: '0' })
  await client.connect(clientTransport)
  try {
    const { tools } = await client.listTools()
    return tools
      .map((t) => {
        const schema = (t.inputSchema ?? {}) as { properties?: Record<string, { type?: string | string[]; description?: string; enum?: string[]; items?: { enum?: string[] } }>; required?: string[] }
        return {
          name: t.name,
          title: t.title ?? null,
          description: t.description ?? '',
          params: Object.entries(schema.properties ?? {}).map(([name, p]) => ({
            name,
            type: p.enum ? p.enum.join(' | ') : p.items?.enum ? `list of ${p.items.enum.join(' | ')}` : Array.isArray(p.type) ? p.type.join(' | ') : (p.type ?? 'any'),
            description: p.description ?? '',
            required: (schema.required ?? []).includes(name),
          })),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } finally {
    await client.close()
    await server.close()
  }
}
