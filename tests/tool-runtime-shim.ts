/**
 * Minimal test-only stand-in for `@deepseek-ai/dsh-tools`' `ToolRuntime`.
 *
 * The published `@deepseek-ai/dsh-tools@0.0.1-rc.1` does not export the
 * `ToolRuntime` service class (it arrived in a later deepseek-harness
 * revision), so the consumer tests cannot build the real runtime. This shim
 * reproduces just the behavior `tests/tools.spec.ts` relies on: register
 * `defineTool`-shaped definitions through `ctx.tools.register`, execute them by
 * name through `ctx.tools.execute`, render successful values with the
 * definition's `output.render`, and shape thrown errors as
 * `{ isError, error: { info?: { code }, message }, content }` — the same
 * envelope the real runtime hands to the model.
 * @module @deepseek-ai/dsh-tool-docx/tests/tool-runtime-shim
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Caller-supplied description of one tool call (mirrors the host input). */
export interface ExecuteInput {
  /** Cancellation for the call. */
  signal: AbortSignal
  /** Opaque call identifier. */
  callId: unknown
  /** Registered tool name. */
  name: string
  /** Raw tool arguments. */
  arguments: unknown
}

/** The result envelope the tests assert against. */
export type ExecuteResult =
  | { isError: false; value: unknown; content: Array<{ type: string; text?: string }> }
  | { isError: true; error: { info?: { code?: string }; message: string }; content: Array<{ type: string; text?: string }> }

/** Test-only `tools` service; see the module docstring. */
export class ToolRuntime extends Service {
  private readonly definitions = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  /** Register a `defineTool`-shaped definition. */
  register(def: ToolDefinition): void {
    this.definitions.set(def.name, def)
  }

  /** Execute a registered tool by name, rendering or wrapping like the real runtime. */
  async execute(input: ExecuteInput): Promise<ExecuteResult> {
    const def = this.definitions.get(input.name)
    if (!def) {
      return { isError: true, error: { message: `unknown tool: ${input.name}` }, content: [] }
    }
    const exec = { signal: input.signal } as ToolExecution
    try {
      const value = await def.execute(input.arguments, exec)
      const content = def.output?.render?.(input.arguments, value) ?? []
      return { isError: false, value, content }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const code = (error as { code?: unknown } | null)?.code
      return {
        isError: true,
        error: typeof code === 'string' ? { info: { code }, message } : { message },
        content: [{ type: 'text', text: message }],
      }
    }
  }
}

export default ToolRuntime
