---
"@react-doctor/core": patch
"react-doctor": patch
---

Fix runtime compatibility with Bun by making child process channel ref/unref calls defensive. When running under Bun, `child.channel` exists but doesn't implement `ref()` and `unref()` methods, causing "child.channel?.unref is not a function" errors. The fix checks if the methods exist before calling them, making the code compatible with both Node.js and Bun runtimes.
