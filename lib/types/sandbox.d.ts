/**
 * The sandbox-escalation API for the mutating docx tools: per-call policy
 * resolution, advertised escalation fields, and denial-marker mapping вЂ” the
 * same pieces `dsh-tool-fs` uses, so docx mutations escalate identically to
 * bash and fs. Built ONCE per plugin from `ctx.fs.sandboxMode`.
 *
 * This mirrors `packages/fs/tool-fs/src/sandbox.ts`; extracting a shared
 * controller is deferred work (see the package README).
 *
 * @module dsh-tool-docx/sandbox
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox';
/** The two escalation arguments a mutating tool may carry. */
export interface DocxEscalationArgs {
    sandbox_permissions?: string;
    justification?: string;
}
/** The schema fields spread into a mutating tool's `parameters` under a confining backend. */
export interface EscalationSchemaFields {
    sandbox_permissions: {
        type: 'string';
        enum: string[];
        description: string;
    };
    justification: {
        type: 'string';
        description: string;
    };
}
/** The docx escalation API: advertisement gating, policy resolution, and denial mapping. */
export declare class DocxSandboxController {
    private readonly ctx;
    /** Escalation targets this composition advertises (`[]` when no confining backend is mounted). */
    readonly escalationModes: readonly SandboxMode[];
    private readonly policy;
    constructor(ctx: Context);
    /**
     * The escalation schema fields for a mutating tool's `parameters` (confining backend only).
     * @returns the two escalation parameter specs.
     */
    schemaFields(): EscalationSchemaFields;
    /**
     * The policy to stamp onto this mutation: an approved escalation grant, else
     * the session's standing mode (with the session cwd as the workspace root).
     * @param toolName - the mutating tool's name, for the approval audit trail.
     * @param args - the call's escalation arguments.
     * @param exec - the tool-execution context.
     * @returns the policy for the mutation, or undefined for an unsandboxed backend.
     */
    resolvePolicy(toolName: string, args: DocxEscalationArgs, exec: ToolExecution): Promise<SandboxExecutionPolicy | undefined>;
    /**
     * Map a thrown provider error for the model: a `FS_SANDBOX_DENIED` becomes a
     * `DocxError` carrying the shared `[sandbox: вЂ¦]` marker plus the same-turn
     * escalation hint (keeping the structured `DOCX_SANDBOX_DENIED` code).
     * @param error - the error thrown by the mutation.
     * @param policy - the policy stamped onto the call.
     * @returns the error to throw.
     */
    mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown;
}
//# sourceMappingURL=sandbox.d.ts.map