// Re-exported from the production utility — see
// `plugin/utils/attach-parent-references.ts` for the canonical
// implementation. Cross-file parsing in production code (e.g.
// `no-mutating-reducer-state` following an imported reducer) needs
// the same parent-attachment pass; consolidating in one place
// avoids the drift two copies would invite.
export { attachParentReferences } from "../plugin/utils/attach-parent-references.js";
