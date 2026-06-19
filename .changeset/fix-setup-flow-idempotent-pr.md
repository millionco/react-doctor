---
"react-doctor": patch
---

Fix the GitHub Actions setup flow opening duplicate PRs and bundling unrelated local changes (#904). Before creating a branch, `openWorkflowPullRequest` now checks for an already-open React Doctor setup PR and surfaces it instead of minting a second timestamped branch, and it bails when the working tree has tracked changes other than the workflow file (which `git checkout -b` + the whole-index `git commit` would otherwise sweep into the PR), falling back to staging the workflow file.
