import { UserError } from '../core/types.js'

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** Wraps a handler: JSON result as text content, user errors as `isError` results. */
export function tool<A>(handler: (args: A) => unknown | Promise<unknown>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      const result = await handler(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      if (error instanceof UserError) return { content: [{ type: 'text', text: error.message }], isError: true }
      throw error
    }
  }
}
