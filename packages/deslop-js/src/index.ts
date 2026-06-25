// deslop-js is a thin published facade. The engine lives in
// `@react-doctor/core` (private) under `src/deslop` and is exposed via the
// `@react-doctor/core/deslop` subpath; `vp pack` bundles it into this
// package's output so the published tarball stays self-contained. Keep this
// file a pure re-export so the public API tracks the engine automatically.
export * from "@react-doctor/core/deslop";
