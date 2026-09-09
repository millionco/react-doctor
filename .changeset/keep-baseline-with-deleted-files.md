---
"react-doctor": patch
---

Keep `--scope changed` in baseline mode when the change set deletes a source file. A deleted file that cannot be read or linted at the base commit no longer degrades the whole comparison to a plain diff; only an unreadable or unlinted base file that still exists at head does, since that is the only gap that could surface a pre-existing finding as new.
