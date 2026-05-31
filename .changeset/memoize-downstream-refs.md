---
"react-doctor": patch
---

Speed up scans of effect-heavy codebases by memoizing `getDownstreamRefs` in the State & Effects rule helpers. `ascend()` re-descended the same large definition subtrees on every recursion step, so the seven effect rules (led by `no-pass-data-to-parent`) blew up superlinearly on big components with many `useEffect`s — re-walking and re-scoping identical bodies across recursion, across effects, and across rules. Caching the downstream-reference lookup per Program node (a `WeakMap` keyed on the per-`Program` analysis singleton, GC-bound with the file) collapses that to a single descent.

On an 866-file Next.js app this cut ~9s (~24%) off a full scan — the worst rule on the largest file (a 1,159-line component with 10 effects) dropped from ~9.5s to ~0.18s, and the hot lint batch from ~13.5s to ~2.5s. Diagnostics are byte-identical (verified by a SHA-256 fingerprint over every diagnostic before/after); the cache only stores arrays callers already read and never mutate.
