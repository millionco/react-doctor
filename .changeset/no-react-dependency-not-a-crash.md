---
"react-doctor": patch
---

Expected, user-actionable failures are no longer reported to Sentry or rendered as crashes.

When react-doctor exits because of the user's project or invocation — not a bug — it now prints a clean, single-line message and exits non-zero, instead of the generic "Something went wrong, open a prefilled issue" block. These cases are also no longer sent to Sentry or counted in the alertable error-rate metric. This was flooding crash reporting with non-bugs from CI, coding agents, and sandboxes.

Covered cases:

- **No React / no project / missing path** — every project-discovery failure (`NoReactDependencyError`, `ProjectNotFoundError`, `PackageJsonNotFoundError`, `NotADirectoryError`, `AmbiguousProjectError`) is now treated as a clean user error (REACT-DOCTOR-1, -4, -6, -7). When the scan target simply doesn't exist on disk, the message now says the path doesn't exist instead of the misleading "Expected a package.json…" guidance.
- **CLI invocation mistakes** — a malformed `<file>:<line>` argument, mutually exclusive flags (e.g. `--yes` + `--full`), and an unknown `--project` name now render as clean errors (REACT-DOCTOR-B, -D, -G, -H).
- **Read-only config directory** — react-doctor no longer crashes when it can't create/read its global setup-prompt store on a locked-down or read-only filesystem; it degrades gracefully (REACT-DOCTOR-E).

The fix is enforced centrally in `reportErrorToSentry`, so the CLI entry point, `inspect`, and `install` all benefit.
