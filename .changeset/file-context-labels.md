---
"react-doctor": patch
---

Diagnostics in test, spec, fixture, and Storybook files are now labeled with their file context. The terminal report and the per-rule text dumps tag those sites as `(test file)` / `(story file)` so a finding in a spec doesn't read as a production problem, and each diagnostic in the JSON report carries an optional `fileContext` field (`"test"` / `"story"`; omitted for production files). The classification reuses the same path heuristics that already drive test-noise auto-suppression, so the label and the suppression can never disagree.
