---
"react-doctor": patch
"@react-doctor/core": patch
---

fix: upgrade deslop-js to 0.0.25 to ensure namespace imports are tracked correctly

Namespace imports (`import * as S from './module'`) are now properly tracked by the dead-code analyzer. Previously, exports accessed via namespace imports (e.g., `<S.Custom />`) could be incorrectly flagged as unused. This fix upgrades deslop-js from 0.0.24 to 0.0.25, which includes improved namespace import tracking, and adds a regression test to prevent future issues.
