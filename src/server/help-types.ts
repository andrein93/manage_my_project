// Plain types shared by the server and the dashboard (no runtime imports here).

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
