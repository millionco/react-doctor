---
"react-doctor": minor
---

Add `--include-untracked` to fold ordinary (non-ignored) untracked files into the `files`, `changed`, and `lines` scopes. Off by default, so the existing scopes are unchanged; Git ignore rules are always respected. The flag requires one of those working-tree scopes — it errors when no scope (or `--scope full`/`--staged`) is set.
