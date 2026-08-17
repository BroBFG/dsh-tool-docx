/**
 * The sandbox-escalation API for the mutating docx tools: per-call policy
 * resolution, advertised escalation fields, and denial-marker mapping — the
 * same pieces `dsh-tool-fs` uses, so docx mutations escalate identically to
 * bash and fs. Built ONCE per plugin from `ctx.fs.sandboxMode`.
 *
 * This mirrors `packages/fs/tool-fs/src/sandbox.ts`; extracting a shared
 * controller is deferred work (see the package README).
 *
 * @module @deepseek-ai/dsh-tool-docx/sandbox
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { ESCALATION_TARGETS, approveEscalation, escalationHintMarker, sandboxDenialMarker, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { FsError } from '@deepseek-ai/dsh-fs'
import { DocxError } from './error.ts'

/** The two escalation arguments a mutating tool may carry. */
export interface DocxEscalationArgs {
  sandbox_permissions?: string
  justification?: string
}

/** The schema fields spread into a mutating tool's `parameters` under a confining backend. */
export interface EscalationSchemaFields {
  sandbox_permissions: { type: 'string'; enum: string[]; description: string }
  justification: { type: 'string'; description: string }
}

/** The docx escalation API: advertisement gating, policy resolution, and denial mapping. */
export class DocxSandboxController {
  /** Escalation targets this composition advertises (`[]` when no confining backend is mounted). */
  readonly escalationModes: readonly SandboxMode[]
  private readonly policy: SandboxPolicyService | undefined

  constructor(private readonly ctx: Context) {
    const defaultMode = ctx.fs.sandboxMode
    this.escalationModes = defaultMode === undefined ? [] : ESCALATION_TARGETS
    this.policy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (defaultMode !== undefined && this.policy === undefined) {
      throw new Error('tool-docx: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  /**
   * The escalation schema fields for a mutating tool's `parameters` (confining backend only).
   * @returns the two escalation parameter specs.
   */
  schemaFields(): EscalationSchemaFields {
    return {
      sandbox_permissions: {
        type: 'string',
        enum: [...this.escalationModes],
        description: 'The wider sandbox mode this file operation needs. Only valid as a one-shot retry '
          + 'of an operation the sandbox just denied; requires justification and user approval.',
      },
      justification: {
        type: 'string',
        description: 'Required with sandbox_permissions: one sentence for the user explaining '
          + 'why this exact file operation needs the wider access.',
      },
    }
  }

  /**
   * The policy to stamp onto this mutation: an approved escalation grant, else
   * the session's standing mode (with the session cwd as the workspace root).
   * @param toolName - the mutating tool's name, for the approval audit trail.
   * @param args - the call's escalation arguments.
   * @param exec - the tool-execution context.
   * @returns the policy for the mutation, or undefined for an unsandboxed backend.
   */
  async resolvePolicy(toolName: string, args: DocxEscalationArgs, exec: ToolExecution): Promise<SandboxExecutionPolicy | undefined> {
    validateEscalationArgs(args.sandbox_permissions, args.justification)
    const standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} })
    if (args.sandbox_permissions === undefined || args.justification === undefined) {
      return standingPolicy
    }
    if (this.escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)')
    }
    const policy = standingPolicy as SandboxExecutionPolicy
    const approvedMode = await approveEscalation(
      { requestedMode: args.sandbox_permissions, justification: args.justification, effectiveMode: policy.mode, subject: 'operation' },
      {
        approver: this.ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName,
        signal: exec.signal,
      },
    )
    return { ...policy, mode: approvedMode }
  }

  /**
   * Map a thrown provider error for the model: a `FS_SANDBOX_DENIED` becomes a
   * `DocxError` carrying the shared `[sandbox: …]` marker plus the same-turn
   * escalation hint (keeping the structured `DOCX_SANDBOX_DENIED` code).
   * @param error - the error thrown by the mutation.
   * @param policy - the policy stamped onto the call.
   * @returns the error to throw.
   */
  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    const mode = (policy as SandboxExecutionPolicy).mode
    return new DocxError(`${sandboxDenialMarker(mode)}\n${escalationHintMarker('operation')}`, 'DOCX_SANDBOX_DENIED', { cause: error })
  }
}
