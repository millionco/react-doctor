# Warning exit code

Job: GitLab CI users need a visible warning status while errors still block a merge. The existing `--blocking` option cannot give warnings a separate exit code.

Change: Add the opt-in `--warning-exit-code <code>` CLI option. A code from 2 to 255 separates warnings from success (0) and blocking failures (1). The existing blocking gate takes priority.

Reuse: Extend the shared scan gate as `resolveScanExitCode`. Keep its hard-failure, CI surface, workspace, score-only, and degraded-baseline rules. Both CLI report modes use it.

Metric: `scan.warning_exit_code.configured` counts CLI scans with the option set. Success means at least 100 CI invocations across the first two releases that contain this option. No code, path, or project identity is sent.

Compatibility: No default, config, package API, JSON schema, or GitHub Action input change. Add a patch Changeset for the CLI. The repository README, CLI help, and distributed skill describe the option. Website and canonical prompt sources are maintained outside this repository.

Review point: At the second release after introduction, review CI usage. If the count stays below 100, review the need for this option before extending it. Any removal needs the normal deprecation process.
