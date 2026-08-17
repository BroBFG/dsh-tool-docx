/**
 * The sandbox-preserving binary fs provider: `DocxSandboxedFileSystem` extends
 * the published `@deepseek-ai/dsh-fs-sandbox` `SandboxedFileSystem` (the exact
 * `ctx.fs` the harness mounts) and adds the binary `writeBytes` primitive
 * through the SAME policy fence as the base's `writeText`/`editText` — mount
 * it in place of the harness's `fs-sandbox` row and the docx tools get
 * `writeBytes` without weakening the sandbox.
 * @module dsh-tool-docx/fs-binary-sandbox
 */
import type { FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs';
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox';
import { type SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { FsBytesWriteOutcome } from './fs-binary.ts';
/**
 * The sandboxed filesystem backend with the binary write primitive. Inherits
 * the full `SandboxedFileSystem` contract (local text/binary reads, fenced
 * `writeText`/`editText`) and adds fenced `writeBytes`: the per-call policy
 * fence runs first (the same containment check the base applies to mutations),
 * then the probe → intent-guard → atomic-publish body. Per-targetKey
 * operations are serialized with a tail promise.
 */
export declare class DocxSandboxedFileSystem extends SandboxedFileSystem {
    private readonly byteLocks;
    private withByteLock;
    /**
     * Enforce the per-call policy against `target` and return the exact target
     * the mutation must use — mirrors the base `SandboxedFileSystem.checkedTarget`
     * (which is private): `danger-full-access` passes unfenced, `read-only`
     * denies, `workspace-write` re-canonicalizes now and requires containment
     * under a writable root. Throws `FS_SANDBOX_DENIED` on refusal.
     */
    private checkedWriteTarget;
    /** Write raw bytes with an optional version/absence guard, through the policy fence. */
    writeBytes(target: FsTarget, data: Uint8Array, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsBytesWriteOutcome>;
}
export default DocxSandboxedFileSystem;
//# sourceMappingURL=fs-binary-sandbox.d.ts.map