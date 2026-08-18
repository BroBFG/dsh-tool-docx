import { n as performByteWrite } from "./fs-binary-local-n8Ls-bn_.js";
import { FsError } from "@deepseek-ai/dsh-fs";
import { writableRoots } from "@deepseek-ai/dsh-sandbox";
import { dirname, sep } from "node:path";
import { stat } from "node:fs/promises";
import { SandboxedFileSystem } from "@deepseek-ai/dsh-fs-sandbox";
//#region lib/types/path-contains.js
/**
* Path-containment mechanics for the plugin's sandboxed filesystem provider —
* ported from the deepseek-harness `fs-sandbox` package (MIT, see LICENSE):
* the lexical fast path handles canonical spellings, and filesystem identity
* supplies the conservative fallback for alias-equivalent roots (Windows 8.3
* names, casing).
* @module dsh-tool-docx/path-contains
*/
const MISSING_CODES = /* @__PURE__ */ new Set(["ENOENT", "ENOTDIR"]);
function isMissing(error) {
	const code = error.code;
	return MISSING_CODES.has(code);
}
function comparablePath(path, caseSensitive) {
	return caseSensitive ? path : path.toLowerCase();
}
function isLexicallyUnder(path, root, caseSensitive) {
	const comparableTarget = comparablePath(path, caseSensitive);
	const comparableRoot = comparablePath(root, caseSensitive);
	if (comparableTarget === comparableRoot) return true;
	const prefix = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
	return comparableTarget.startsWith(prefix);
}
async function statIfPresent(path) {
	try {
		return await stat(path, { bigint: true });
	} catch (error) {
		if (isMissing(error)) return void 0;
		throw error;
	}
}
function sameIdentity(left, right) {
	return left.dev === right.dev && left.ino === right.ino;
}
/**
* Determine whether a canonical target is a writable root or lies beneath it.
* The lexical fast path handles normal canonical spellings; when spellings
* differ, walk the target's existing ancestors and compare filesystem identity
* with the root.
* @param path - canonical target key, which may end in a missing suffix.
* @param root - canonical writable root.
* @param caseSensitive - whether lexical comparison preserves case; defaults
* to the host filesystem convention used by supported platforms.
* @returns whether the target is the root or a descendant of it.
*/
async function isPathUnder(path, root, caseSensitive = process.platform !== "win32") {
	if (isLexicallyUnder(path, root, caseSensitive)) return true;
	const rootInfo = await statIfPresent(root);
	if (!rootInfo) return false;
	let ancestor = path;
	while (true) {
		const ancestorInfo = await statIfPresent(ancestor);
		if (ancestorInfo && sameIdentity(ancestorInfo, rootInfo)) return true;
		const parent = dirname(ancestor);
		if (parent === ancestor) return false;
		ancestor = parent;
	}
}
//#endregion
//#region lib/types/fs-binary-sandbox.js
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
async function checkWriteTarget(resolveTarget, policy, target) {
	const { mode } = policy;
	if (mode === "danger-full-access") return target;
	if (mode === "read-only") throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, "FS_SANDBOX_DENIED");
	const fresh = await resolveTarget(target.displayPath);
	let contained = false;
	for (const root of writableRoots(policy)) if (await isPathUnder(fresh.targetKey, root)) {
		contained = true;
		break;
	}
	if (!contained) throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, "FS_SANDBOX_DENIED");
	return fresh;
}
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
var DocxSandboxedFileSystem = class extends SandboxedFileSystem {
	byteLocks = /* @__PURE__ */ new Map();
	withByteLock(key, op) {
		const next = (this.byteLocks.get(key) ?? Promise.resolve()).then(op, op);
		this.byteLocks.set(key, next.then(() => void 0, () => void 0));
		return next;
	}
	/**
	* Enforce the per-call policy against `target` and return the exact target
	* the mutation must use, via the shared {@link checkWriteTarget}.
	*/
	async checkedWriteTarget(target, sandboxPolicy) {
		return checkWriteTarget((path) => this.resolve(path), sandboxPolicy ?? this.ctx.sandboxPolicy.resolve(), target);
	}
	/** Write raw bytes with an optional version/absence guard, through the policy fence. */
	async writeBytes(target, data, expected, signal, sandboxPolicy) {
		const checked = await this.checkedWriteTarget(target, sandboxPolicy);
		return this.withByteLock(String(checked.targetKey), () => performByteWrite(this, checked, data, expected, signal));
	}
};
//#endregion
export { checkWriteTarget as n, DocxSandboxedFileSystem as t };
