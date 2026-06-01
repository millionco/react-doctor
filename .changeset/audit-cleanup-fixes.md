---
"react-doctor": patch
---

Treat `CI=1` and `CI=True` as CI environments, not just `CI=true`. CI-only behavior (suppressing the share URL, marking the run as CI-originated for scoring) now triggers consistently across providers that set `CI` to a truthy value other than the literal string `"true"`; explicit `CI=false` / `CI=0` are still treated as non-CI.

A present-but-unparseable `react-doctor.config.json` at the scanned root no longer silently falls through to a parent directory's config. The tool stops there instead of letting an ancestor repo's config govern the project; a `package.json` `reactDoctor` config in the same directory is still used as a fallback.
