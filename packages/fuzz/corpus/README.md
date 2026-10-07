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

Seeds with `// verdict: pass` or `// verdict: fail` are replayed
deterministically by both the smoke suite and targeted fuzzing. Seeds without a
verdict remain mutation-only inputs. `firedProgramCount` is still a coverage
stat rather than a correctness oracle for generated programs.

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
// react-major: <major, only when the false positive depends on React version>
```

Files may use `.ts`, `.tsx`, `.js`, or `.jsx` and must parse cleanly (`pnpm test` enforces it).

## Exact audit corpora

`react-bench-0.9.7-audit/` and `dummy-threejs-v14-audit/` preserve complete source files from
exhaustive production-corpus reviews. Their manifests pin the source-report hashes, audited
callsites, source-line hashes, expected verdict counts, and fixture mappings. Regression files use
`// audit-verdict: pass` because the exact source can contain unrelated valid findings; they remain
mutation seeds instead of claiming the entire file must be diagnostic-free. True-positive files use
`// verdict: fail` and are replayed deterministically.

Regenerate the Dummy corpus from its archived scan artifacts with:

```sh
node scripts/import-dummy-threejs-audit-corpus.mjs \
  <before-diagnostics.tsv> <after-diagnostics.tsv> <selected-roots.txt> \
  corpus/dummy-threejs-v14-audit corpus/dummy-threejs-v14-audit.json
```
