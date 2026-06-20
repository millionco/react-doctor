---
"@react-doctor/core": patch
"react-doctor": patch
"deslop-js": patch
---

Skip the deslop analysis passes whose output react-doctor discards — an ~8.5x speedup of the dead-code phase on large repos.

react-doctor consumes only deslop's graph dead-code findings: unused files, unused exports, unused dependencies, and circular dependencies. The dead-code worker projects exactly those four off deslop's result (`check-dead-code.ts` `normalizeResult`); the other ~18 fields deslop computes never cross the worker boundary. Two of deslop's passes produce only discarded output and are the bulk of the runtime: the full-TypeScript-Program **semantic** pass (unused types / enum & class members / misclassified deps), and a set of **code-quality** detectors (duplicate-block / copy-paste detection, complexity hotspots, feature flags, TypeScript smells, private-type leaks, re-export cycles). Profiling a ~9k-file repo (Sentry) showed `generateReport` was ~90% of the phase and duplicate-block detection alone was ~83s of ~130s.

deslop gains a `reportCodeQuality` flag (default `true`, so deslop used standalone is unchanged) that gates those six code-quality detectors — they were the only expensive detectors still running unconditionally while the cheaper redundancy detectors were already opt-in. react-doctor's dead-code worker now passes both `semantic: { enabled: false }` and `reportCodeQuality: false`.

Measured on Sentry: deslop drops from ~132s to ~15.5s (8.5x) with byte-identical consumed findings (198 unused files, 10 unused exports, 4 unused deps, 137 cycles), and a full supply-chain-on scan drops from ~142s to ~40s. Skipping these is provably safe — each consumed finding comes from its own detector, independent of the disabled passes — and a parity test locks the invariant so a future deslop change that ever coupled a consumed finding to either pass fails CI first.
