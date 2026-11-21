---
"react-doctor": patch
---

Fix GitLab CI base ref for detached shallow checkouts

The GitLab CI job template now uses `$CI_MERGE_REQUEST_DIFF_BASE_SHA` instead of `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME` for the `--base` flag. In GitLab merge request pipelines, the checkout is detached and shallow, so branch names don't resolve. The diff base SHA is always available and resolvable. Existing configs with the old variable are automatically upgraded to use the new one.
