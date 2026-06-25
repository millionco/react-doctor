---
"oxlint-plugin-react-doctor": patch
---

Extract the control-flow graph into a dedicated internal `@react-doctor/cfg` package.

The per-function CFG builder and its dominance / reachability analyses now live in their own self-contained package (bundled into the plugin at build time, so the published surface is unchanged). The package ships a typed `analyzeControlFlow` API, a README documenting the modeled terminal taxonomy, and a full port of oxc's `eslint/no-unreachable` `pass` / `fail` corpus asserted directly against the graph's `isUnreachable`.
