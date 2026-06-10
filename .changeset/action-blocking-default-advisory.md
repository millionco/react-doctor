---
"react-doctor": patch
---

The GitHub Action's `blocking` input now defaults to `none` (advisory) instead of `error`. Every PR still gets the full React Doctor report — the sticky summary comment, inline review comments, and a commit status with the health score — but the check no longer fails on findings, so a brand-new install can't red-X a teammate's PR on day one (trust-before-gate). To turn the gate back on, set `blocking: warning` (fail on any finding) or `blocking: error` (fail on error-severity findings) on the action. The generated `react-doctor.yml` documents this inline.

Note: this changes behavior for existing `millionco/react-doctor@v2` workflows that never set `blocking` — they were gating on error-severity findings and will now run advisory. Add `blocking: error` to the action's `with:` block to keep the previous behavior.

The CLI / config default is unchanged: `react-doctor` (and `--blocking` / the `blocking` config key) still defaults to `error`, so local runs, pre-commit hooks, and non-action CI keep failing on error-severity findings.
