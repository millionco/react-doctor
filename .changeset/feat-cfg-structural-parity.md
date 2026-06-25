---
"oxlint-plugin-react-doctor": patch
---

Upgrade `@react-doctor/cfg` to a full structural control-flow graph.

Each basic block is now a typed instruction list ending in a first-class `Terminal` modeled on the React Compiler HIR taxonomy (`goto` / `if` / `switch` / loops / `logical` / `ternary` / `optional` / `try` / `return` / `throw`), with `fallthrough` join blocks and explicit `goto` lowering of `break` / `continue`. Dominance now uses the Cooper–Harvey–Kennedy immediate-dominator tree over reverse-postorder (plus the Cytron dominance frontier as the SSA seam). New analysis surface: `dominanceFrontier`, `isInfiniteLoopStart` (oxc-parity constant folding), and a Graphviz `toDot` export. The builder is split into `ir/` + `build/` + `analysis/` modules, and curated parity corpora from oxc (`no-fallthrough`, `no-unsafe-finally`, `getter-return`), ESLint code-path analysis, and React Compiler `BuildHIR` are ported as tests. The published plugin behavior is unchanged (all rule tests pass); this is an internal engine upgrade bundled at build time.
