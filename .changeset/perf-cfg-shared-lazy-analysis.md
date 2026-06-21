---
"oxlint-plugin-react-doctor": patch
---

Make the CFG-backed rules' shared analysis layer roughly twice as fast, with no change in diagnostics.

Every rule is wrapped with a per-file semantic context, but each wrapper rebuilt the scope tree, control-flow graph, SSA, and definite-assignment analysis on its own — so a single file rebuilt the CFG once per CFG-reading rule (and SSA/definite-assignment each rebuilt it again internally). The build is now shared across all rules over the same file via a `Program`-keyed `WeakMap` (the pattern already used for the effect rules' scope analysis), and the one CFG is threaded into SSA and definite-assignment instead of each constructing its own.

The CFG's per-function derived structures (dominator and post-dominator trees, loop membership, reachability, the unconditional-from-entry set, source-order index) are now computed lazily on first query and memoized, so a rule that only asks `isInsideLoop` no longer pays for two dominator trees. Loop-membership detection drops from an O(V^3) per-block self-reachability scan to a single O(V+E) strongly-connected-components pass, the reachability and unconditional traversals stop re-shifting their BFS queues, `forEachChildNode` no longer allocates a key array per AST node, and the simple-path enumerator gained a global visit budget so a branch-heavy file can't blow up.

Behavior is unchanged: the loop and unconditional rewrites are pinned by parity tests against the original implementations, and the whole change was differential-tested — running every CFG/SSA/typestate-backed rule over a corpus of adversarial edge cases plus the fixtures, in both rule orders, produced byte-identical diagnostics before and after.
