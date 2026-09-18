---
"@react-doctor/core": patch
---

Add regression tests for React Compiler detection with @rolldown/plugin-babel. The detection logic already correctly handles reactCompilerPreset() with @rolldown/plugin-babel (working in 0.9.2), but these tests prevent future regressions.
