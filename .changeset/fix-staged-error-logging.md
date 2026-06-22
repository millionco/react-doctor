---
"react-doctor": patch
---

fix(staged): log warning when getStagedSourceFiles encounters git errors

When git commands fail (missing git binary, corrupted repo, permission errors), `getStagedSourceFiles` now logs a warning message showing the error instead of silently returning an empty array. This makes `--staged` failures much easier to debug while still gracefully degrading.
