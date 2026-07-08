# Fuzz regression corpus

Every file here is a **confirmed false positive**: correct, idiomatic code
that a rule once wrongly flagged. The harness always loads this directory
(no env needed) and fuzzes these programs plus mutated/crossed-over
descendants — concentrating inputs on the detection logic that has
historically been weakest.

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

Files must parse cleanly as TSX (`pnpm test` enforces it) — they are valid
programs by definition.
