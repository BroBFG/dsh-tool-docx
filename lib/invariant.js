//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `dsh-tool-docx`.
* @module dsh-tool-docx/invariant
*/
const PACKAGE_NAME = "dsh-tool-docx";
/** Cordis companion plugin name. */
const name = "tool-docx-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the tools are model-facing consumers of the filesystem
* seam; execution relations are owned by the seam they call.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
