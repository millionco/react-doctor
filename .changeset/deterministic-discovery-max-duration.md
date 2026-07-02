---
"@react-doctor/core": patch
"react-doctor": patch
---

Make file discovery deterministic and artifact-free, and add `--max-duration` for graceful partial results on slow scans.

- File discovery is now identical between the git-tracked path (`git ls-files`) and the filesystem walk: the walk descends into non-ignored dot-directories (e.g. `.dumi`, `.storybook`) instead of skipping every dot-directory, and its output is sorted. Repeated scans of the same tree produce the same file set regardless of which discovery path runs.
- Committed build output (`dist/`, `build/`, `out/`, `.next/`, `coverage/`, `storybook-static/`, …) is excluded from both discovery paths by path-segment filtering. Previously `git ls-files` listed tracked bundles (gitignore only hides untracked files), so bundled artifacts like `ai/dist/mcp-server.js` were linted.
- New `--max-duration <seconds>` flag: when the budget is spent, remaining lint batches and the dead-code pass are skipped and the scan returns partial results with the skipped files reported explicitly, instead of a SIGTERM'd empty `{"ok":false,"projects":[]}` report. The budget applies once to the whole invocation — every project of a workspace scan shares it — and a scan whose dead-code pass failed or was truncated reports a `null` score rather than one computed from an incomplete diagnostic set.
