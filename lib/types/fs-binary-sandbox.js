/**
 * The sandbox-preserving binary fs provider: `DocxSandboxedFileSystem` extends
 * the published `@deepseek-ai/dsh-fs-sandbox` `SandboxedFileSystem` (the exact
 * `ctx.fs` the harness mounts) and adds the binary `writeBytes` primitive
 * through the SAME policy fence as the base's `writeText`/`editText` — mount
 * it in place of the harness's `fs-sandbox` row and the docx tools get
 * `writeBytes` without weakening the sandbox.
 * @module dsh-tool-docx/fs-binary-sandbox
 */
import { FsError } from '@deepseek-ai/dsh-fs';
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox';
import { writableRoots } from '@deepseek-ai/dsh-sandbox';
import { performByteWrite } from "./fs-binary-local.js";
import { isPathUnder } from "./path-contains.js";
/**
 * The sandboxed filesystem backend with the binary write primitive. Inherits
 * the full `SandboxedFileSystem` contract (local text/binary reads, fenced
 * `writeText`/`editText`) and adds fenced `writeBytes`: the per-call policy
 * fence runs first (the same containment check the base applies to mutations),
 * then the probe → intent-guard → atomic-publish body. Per-targetKey
 * operations are serialized with a tail promise.
 */
export class DocxSandboxedFileSystem extends SandboxedFileSystem {
    byteLocks = new Map();
    withByteLock(key, op) {
        const previous = this.byteLocks.get(key) ?? Promise.resolve();
        const next = previous.then(op, op);
        // Keep the tail for the next call, swallowing the error so the map entry
        // never holds a rejected promise.
        this.byteLocks.set(key, next.then(() => undefined, () => undefined));
        return next;
    }
    /**
     * Enforce the per-call policy against `target` and return the exact target
     * the mutation must use — mirrors the base `SandboxedFileSystem.checkedTarget`
     * (which is private): `danger-full-access` passes unfenced, `read-only`
     * denies, `workspace-write` re-canonicalizes now and requires containment
     * under a writable root. Throws `FS_SANDBOX_DENIED` on refusal.
     */
    async checkedWriteTarget(target, sandboxPolicy) {
        const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
        const { mode } = policy;
        if (mode === 'danger-full-access')
            return target;
        if (mode === 'read-only') {
            throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED');
        }
        // workspace-write: containment on the FRESH canonical path (catches a
        // symlink ancestor swapped since the tool resolved this target), and the
        // mutation delegates with THIS fresh target — never the stale one.
        const fresh = await this.resolve(target.displayPath);
        let contained = false;
        for (const root of writableRoots(policy)) {
            if (await isPathUnder(fresh.targetKey, root)) {
                contained = true;
                break;
            }
        }
        if (!contained) {
            throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED');
        }
        return fresh;
    }
    /** Write raw bytes with an optional version/absence guard, through the policy fence. */
    async writeBytes(target, data, expected, signal, sandboxPolicy) {
        const checked = await this.checkedWriteTarget(target, sandboxPolicy);
        return this.withByteLock(String(checked.targetKey), () => performByteWrite(this, checked, data, expected, signal));
    }
}
export default DocxSandboxedFileSystem;
//# sourceMappingURL=fs-binary-sandbox.js.map