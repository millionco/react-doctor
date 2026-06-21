---
"@react-doctor/core": patch
---

Batch file arguments in `Git.changedLineRanges` to prevent `ENAMETOOLONG` on Windows. Issue [#924](https://github.com/millionco/react-doctor/issues/924) reported scan aborts on `--scope lines` with large file sets: Windows CreateProcessW caps command-line args at 32,767 chars, and passing all file paths directly to `git diff` exceeded that limit. The fix applies the same batching logic used for oxlint spawns (issue [#46](https://github.com/millionco/react-doctor/issues/46)) — file arguments are now split into batches under `SPAWN_ARGS_MAX_LENGTH_CHARS` (24,000), each batch is diffed separately, and `parseChangedLineRanges` aggregates the results. References Sentry issues REACT-DOCTOR-1E, REACT-DOCTOR-1P, REACT-DOCTOR-20.
