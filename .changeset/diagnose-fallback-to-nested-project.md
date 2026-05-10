---
"react-doctor": patch
---

`diagnose()` now falls back to the first nested React subproject when the
requested directory has no root `package.json`, instead of crashing with
`No package.json found in <directory>`. This unblocks external review
runners (e.g. the Vercel AI Code Review sandbox) that point `diagnose()`
at the cloned repo root for projects whose `package.json` lives in a
subfolder like `apps/web`. When neither the root nor any nested
subdirectory contains a React project, `diagnose()` now throws a clearer
`No React project found in <directory>` error.
