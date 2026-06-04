---
"react-doctor": minor
---

Remove the redundant `--full` flag. It was equivalent to `--diff false` (force a full scan, overriding a config-set `diff`), and a full scan is already the default. Use `--diff false` to override a configured diff for a single run. Dropping it also removes the `--yes` + `--full` mutual-exclusion error (the most common combined-flag crash).
