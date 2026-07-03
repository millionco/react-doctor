---
"oxlint-plugin-react-doctor": patch
---

perf: cache compiled glob RegExps in `compileGlob` so rules matching user-configured patterns per node stop recompiling the same pattern on every call
