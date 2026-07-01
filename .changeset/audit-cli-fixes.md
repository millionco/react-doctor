---
"react-doctor": patch
---

CLI fixes from a 20-day audit

- Agent hooks no longer produce a false "React Doctor found issues" message on
  every edit on Windows: cmd.exe's exit code 9009 now falls through to the next
  runner candidate, the local bin is probed with `existsSync` (its `./` form is
  not runnable by cmd.exe), scan output survives large `--verbose` diffs via a
  16 MiB spawn buffer, and an unwritable temp dir no longer crashes the hook.
- Re-running `react-doctor install --agent-hooks` now replaces the legacy
  `react-doctor.sh` hook from ≤0.5.8 (and deletes the orphaned script) instead
  of stacking a second hook that scanned every edit twice.
- `ci upgrade --pr` no longer silently drops the upgrade when a React Doctor
  setup PR is already open: the workflow file is restored and the command
  explains the pending PR must merge first.
- `ci config` on a workflow with a YAML syntax error now prints the
  apply-by-hand snippet instead of crashing with an internal error
  (`Document with errors cannot be stringified`).
