---
"@react-doctor/core": patch
"react-doctor": patch
---

Add a `--output-dir <dir>` flag that writes the full diagnostics dump (diagnostics.json + one .txt per rule) to a directory of your choice instead of a random temp folder, prints the written path whenever the flag is set (previously `--verbose`-only), and makes the agent handoff reuse that directory instead of writing a second temp copy. Without the flag, behavior is unchanged.
