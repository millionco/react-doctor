---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Undo the 0.6.0 scan-time regression and cut lint CPU ~30% below it (~20% below 0.5.8). Diagnostics are byte-identical throughout; verified per-change on a 1.8k-file monorepo.

- Share the plugin's scope and control-flow analyses across every rule linting a file. The semantic-context wrapper cached each analysis in a per-rule closure, so every scope-reading rule re-ran the full O(file) analysis on the same AST (~20% of plugin lint CPU, and the multiplier grew as 0.6.0 added scope-hungry false-positive guards — the main driver of the regression). One analysis per Program node now serves all rules.
- Stop wrapping every visitor of every rule in a root-capture closure — Program enter fires first, so capturing there removes a function call per (node × rule).
- Yield the cooperative security scan by time budget instead of file count. It yielded every 16 files, so one large minified bundle could hold the event loop for its whole rule set — and lint's child processes are spawned and drained from main-thread continuations, so each stall idled the whole worker pool (worst on 2-core CI runners). It now hands the loop back after any 12ms slice, checked between every (file, rule) step.
- Memoize `isTestlikeFilename` (every rule re-ran ~70 substring scans per file), collect imports from `Program.body` instead of a whole-program recursion, and skip the generated-image (OG/satori) sweep when the module imports no image-response library.
- Defer `js-combine-iterations`' generator-name collection to the first chained-iteration candidate, and collect only the node kinds `only-export-components` consumes instead of materializing every node in the program.
- Stop double-linting cache misses. With the per-file lint cache enabled, every miss ran twice — once in the cacheable pass, again in the always-fresh cross-file sidecar over every file — so a cold-cache scan (every CI run) paid ~2× the lint parse and spawn cost. Misses now run the full config once and hits get the sidecar only; the fresh output is partitioned by rule id, so cache contents, staleness guarantees, and reported diagnostics are unchanged (cold-cache lint CPU −40% measured).
