// The canonical "what does an analysis pass read?" contract, published as the
// `deslop-js/analyzed-inputs` subpath so external result caches (react-doctor's
// dead-code cache) can fingerprint exactly the files a pass depends on. Kept
// as a dedicated dependency-free entry: the package root eagerly loads
// `typescript` and the native oxc bindings, which a fingerprinting caller must
// never pay for.
export { ANALYZED_MANIFEST_FILENAMES, DEFAULT_EXTENSIONS } from "./constants.js";
