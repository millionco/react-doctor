---
"@react-doctor/core": patch
"react-doctor": patch
---

Add a `--output-dir <directory>` flag so the full diagnostics dump
(diagnostics.json + one .txt per rule) is written to a directory you choose
instead of a random per-run temp folder. The written path is printed in the
summary whenever the flag is set (previously only under `--verbose`), and the
agent-handoff prompt reuses the same directory instead of writing a second
temp copy. Default behavior is unchanged: without the flag, the dump still
goes to a fresh temp directory.
