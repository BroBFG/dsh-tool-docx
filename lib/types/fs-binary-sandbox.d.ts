/**
 * The sandbox-preserving binary fs provider: `DocxSandboxedFileSystem` extends
 * the published `@deepseek-ai/dsh-fs-sandbox` `SandboxedFileSystem` and adds the
 * binary `writeBytes` primitive through the SAME policy fence as the base's
 * `writeText`/`editText`. The fence itself (`checkWriteTarget`) is shared with
 * the `fs-binary-sandbox-plugin` namespace plugin, which registers it as the
 * separate `fsBinary` service — the recommended mount for sandboxed hosts,
 * because it never replaces the host's own `ctx.fs`.
 * @module dsh-tool-docx/fs-binary-sandbox
 */
import { type FsTarget, type FsWriteIntent } from '@deepseek-ai/dsh-fs';
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox';
import { type SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { FsBytesWriteOutcome } from './fs-binary.ts';
/**
 * Enforce the per-call policy against `target` and return the exact target the
 * mutation must use — the same containment the base `SandboxedFileSystem`
 * applies to its mutations (`danger-full-access` passes unfenced, `read-only`
 * denies, `workspace-write` re-canonicalizes now and requires containment under
 * a writable root). Throws `FS_SANDBOX_DENIED` on refusal.
 * @param resolveTarget - resolves a display path to a fresh canonical target
 * (the provider's own `resolve`, so the checked identity is the mutated one).
 * @param policy - the per-call mode and workspace root.
 * @param target - the caller's resolved target.
 * @returns the fresh target the mutation must use.
 */
export declare function checkWriteTarget(resolveTarget: (displayPath: string) => Promise<FsTarget>, policy: SandboxExecutionPolicy, target: FsTarget): Promise<FsTarget>;
/**
 * The sandboxed filesystem backend with the binary write primitive. Inherits
 * the full `SandboxedFileSystem` contract (local text/binary reads, fenced
 * `writeText`/`editText`) and adds fenced `writeBytes`: the per-call policy
 * fence runs first (the same containment check the base applies to mutations),
 * then the probe → intent-guard → atomic-publish body. Per-targetKey
 * operations are serialized with a tail promise. Intended for hosts that want
 * the full backend mounted AS `ctx.fs` (replacing `fs-sandbox` deliberately);
 * the default mount for sandboxed hosts is the `fs-binary-sandbox-plugin`,
 * which registers this same fenced write under the separate `fsBinary` service.
 */
export declare class DocxSandboxedFileSystem extends SandboxedFileSystem {
    private readonly byteLocks;
    private withByteLock;
    /**
     * Enforce the per-call policy against `target` and return the exact target
     * the mutation must use, via the shared {@link checkWriteTarget}.
     */
    private checkedWriteTarget;
    /** Write raw bytes with an optional version/absence guard, through the policy fence. */
    writeBytes(target: FsTarget, data: Uint8Array, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsBytesWriteOutcome>;
}
export default DocxSandboxedFileSystem;
//# sourceMappingURL=fs-binary-sandbox.d.ts.map