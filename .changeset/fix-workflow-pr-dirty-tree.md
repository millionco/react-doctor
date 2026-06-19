---
"react-doctor": patch
---

Fix GitHub Actions setup flow bundling unrelated local changes into PRs. The setup flow now checks for a clean working tree before creating a PR branch. When tracked changes (staged or unstaged) are present, it falls back to staging the workflow file for manual commit instead of attempting to create a PR. Untracked files like the just-written workflow are still allowed. Fixes #904.
