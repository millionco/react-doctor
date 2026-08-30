---
"oxlint-plugin-react-doctor": patch
---

fix: treat ambiguous paths like /tools/ and /migrations/ as production inside source roots

Rules tagged `test-noise` were silently skipping files in paths containing `/tools/`, `/migrations/`, `/scripts/`, `/cli/`, `/bin/`, etc., even when nested inside application source roots like `src/components/tools/`. These directories are ambiguous: at the repo root they're typically build tooling, but inside source roots they're often feature areas.

The heuristic now distinguishes between:
- **Unambiguous non-production** (test/fixture/story/benchmark/demo/examples): always skipped regardless of depth
- **Ambiguous build tooling** (/tools/, /migrations/, /scripts/, etc.): only skipped at repo root, not inside source roots

This lets test-noise rules correctly fire on production feature areas like `src/components/tools/` while still skipping top-level build tooling like `<repo>/tools/`.

Component library demos (`/demo/`, `/examples/`) remain unambiguous and are skipped everywhere, as they're genuinely non-production even when nested in component source (e.g., `components/Button/demos/`).

Fixes #1724
