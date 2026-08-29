---
"oxlint-plugin-react-doctor": patch
---

fix(no-loading-flag-reset-outside-finally): allow unconditional resets in finally after cleanup statements

Fixes #1698. The rule was incorrectly flagging loading-flag resets in finally blocks when preceded by other statements (e.g., `guard.unlock()`). Now only explicit control flow (return/throw) before a reset makes it conditional, not potentially-throwing calls.
