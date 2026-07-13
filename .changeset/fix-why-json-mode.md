---
"react-doctor": patch
---

fix(cli): write JSON error report when `why` command used with `--json`

Fixes issue #1235 where the `why` command would exit with status 0 without producing a JSON report when `--json` was specified. Now properly detects JSON mode and writes a structured error report indicating that the `why` command does not support JSON mode.
