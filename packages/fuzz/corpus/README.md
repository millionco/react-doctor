# Fuzz corpus

The harness always loads this directory (no env needed) and fuzzes these
programs plus mutated/crossed-over descendants — concentrating inputs on
the detection logic that has historically been weakest.

Two seed families, split by expected rule verdict:

- `regressions/` — every file is a **confirmed false positive**: correct,
  idiomatic code that a rule once wrongly flagged.
- `true-positives/` — every file is a **confirmed true positive**: a
  genuine bug a rule must flag, kept as a mutation seed so its shape keeps
  applying pressure.

The harness enforces **no firing expectations** for either family — its
oracles are crash, slowness, verdict-preserving invariance, and verdict
drops, and `firedProgramCount` is a coverage stat only. Whether a seed must
or must not fire is pinned by the owning rule's unit test file, never by
fuzzing.

**The evolving loop (see the `fuzz` skill):** whenever a new false positive
is confirmed — from a user report, an RDE eval, a react-bench run, review,
or a fuzz invariant finding — add a minimal reproducer here as
`regressions/<rule-id>--<slug>.tsx` with a header comment naming the rule
and the weakness class. The next fuzz run picks it up automatically.

Header format:

```tsx
// rule: <rule-id>
// weakness: <alias-guard | copy-tracking | name-heuristic | paren-shape |
//            framework-gating | test-gating | control-flow |
//            wrapper-transparency | library-idiom | cross-file | other>
// source: <PR/issue/session reference>
```

Files must parse cleanly as TSX (`pnpm test` enforces it).
