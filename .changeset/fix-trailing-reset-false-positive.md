---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `no-loading-flag-reset-outside-finally` for non-rethrowing catch with trailing reset

The rule now correctly recognizes that a trailing reset after a `try/catch` block is safe when the catch handler doesn't rethrow, even if it contains user code calls like `toast.show()`. The fix distinguishes between:
- Built-in calls that might throw (JSON.parse, Math.round with invalid args) - still flagged
- Known-throwing local functions - still flagged  
- User code calls on non-built-in objects - now allowed

This resolves the conflict with React Compiler, which cannot handle `try/finally` and requires the `catch-without-rethrow + trailing-reset` pattern.
