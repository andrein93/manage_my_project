import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { App } from '../core/app.js'
import { tool } from './tool.js'

export function registerSyncTools(server: McpServer, app: App): void {
  server.registerTool(
    'sync_now',
    {
      title: 'Sync with team',
      description: "Pull the team's changes and push the user's shared projects to the team server.",
      inputSchema: {},
    },
    tool(() => app.sync.run()),
  )

  server.registerTool(
    'list_members',
    { title: 'List team members', description: 'Team members (for assigning tasks).', inputSchema: {} },
    tool(() => app.sync.members()),
  )
}
