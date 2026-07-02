---
"react-doctor": patch
---

CLI audit fixes:

- Windows agent hooks no longer report false findings on every edit (cmd.exe's exit 9009 falls through, the local bin is probed as the runnable `.cmd` shim, 16 MiB output buffer, guarded output read).
- Legacy `.sh` agent hooks (≤0.5.8) are upgraded to the current Node hook by a once-per-repo migration on your next interactive scan (and on re-install) instead of scanning every edit twice; the cleanup is anchored to the exact legacy install paths and never touches unrelated hook groups in your settings.
- `ci upgrade --pr` restores the workflow file and explains an already-open React Doctor PR instead of silently claiming success; `ci config` bails to the apply-by-hand snippet on YAML syntax errors instead of crashing.
- The action-pin migration only rewrites `millionco/react-doctor` refs (in any owner casing) — a fork's `@main` is no longer rewritten to a tag that may not exist on the fork.
- Baseline and `--staged` scans resolve `config.plugins` from the real config directory, so custom-plugin findings are no longer mislabeled as newly introduced.
- A workspace module's `noScore: true` survives workspace scans, and the multi-project share prompt honors each project's merged `noScore`/`share` — any opted-out project now suppresses the aggregate share link.
- Degraded baseline results are no longer cached, and older binaries treat a newer CLI state schema as read-only (reads never rewrite the state file).
