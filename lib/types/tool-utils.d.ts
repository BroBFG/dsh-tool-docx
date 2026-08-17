/**
 * Shared helpers for the docx tools: path/extension validation, session-cwd
 * resolution, observed-state emission, and common argument validation.
 * @module dsh-tool-docx/tool-utils
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type { FsTarget, FsVersion } from '@deepseek-ai/dsh-fs';
/**
 * Reject `.doc` with the legacy hint; everything else is parsed by content.
 * @param path - the file path to check.
 */
export declare function assertSupportedExtension(path: string): void;
/**
 * Validate a non-empty file path; whitespace-only paths are rejected like the fs tool suite.
 * @param path - the raw tool argument.
 * @returns the same path, confirmed non-blank.
 */
export declare function requirePath(path: string): string;
/**
 * The calling agent's session cwd, or undefined for a non-agent caller.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the agent's session workspace cwd, or undefined.
 */
export declare function sessionCwd(exec: ToolExecution): string | undefined;
/**
 * Resolution options for the current call: session cwd + cancellation.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @returns provider resolution options for the current tool call.
 */
export declare function resolveOptions(exec: ToolExecution): {
    cwd?: string;
    signal?: AbortSignal;
};
/**
 * Record an authoritative positive observation (no-op when no policy listens).
 * @param ctx - the Cordis context the event is emitted on.
 * @param target - the observed target.
 * @param version - the observed file version.
 * @param exec - the tool-execution context, carried as the event actor.
 */
export declare function emitObserved(ctx: Context, target: FsTarget, version: FsVersion, exec: ToolExecution): void;
/**
 * Record a confirmed-absent observation (no-op when no policy listens).
 * @param ctx - the Cordis context the event is emitted on.
 * @param target - the observed (absent) target.
 * @param exec - the tool-execution context, carried as the event actor.
 */
export declare function emitAbsent(ctx: Context, target: FsTarget, exec: ToolExecution): void;
/**
 * Validate a positive-integer cap from config.
 * @param name - the config field name, for the error message.
 * @param value - the configured value to validate.
 */
export declare function assertPositiveInteger(name: string, value: number): void;
//# sourceMappingURL=tool-utils.d.ts.map