---
"react-doctor": patch
---

`--diff` now accepts git commit ranges, and a bad `--diff` value is no longer treated as a crash.

- `--diff A..B` (two-dot, diff A directly against B) and `--diff A...B` (three-dot, diff from the merge-base of A and B to B) are now supported, matching git's own range syntax — an empty endpoint defaults to `HEAD` (`main..` ⇒ `main..HEAD`). Previously any value containing `..` was rejected outright, so `react-doctor --diff 7694215..c4de712` failed. Each range endpoint is still individually validated against the anti-injection guard, so a range can't smuggle a `--upload-pack=…`-style option past it.
- An invalid `--diff` value (a malformed ref/range or a base branch that hasn't been fetched) is now rendered as a clean, single-line message and exits non-zero — it no longer prints the generic "Something went wrong, open a prefilled issue" block or reports the expected user error to Sentry.
