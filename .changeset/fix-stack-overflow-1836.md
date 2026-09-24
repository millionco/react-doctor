---
"oxlint-plugin-react-doctor": patch
---

fix(no-hydration-branch): prevent stack overflow on circular cross-file parameter dependencies

Fixes #1836 - RangeError: Maximum call stack size exceeded in `no-hydration-branch-on-browser-global` since 0.9.12.

The bug was introduced when cross-file helper resolution was added. `createArgumentResolutionState` cleared `visitedSymbolIds` when switching contexts, breaking cycle detection for circular parameter dependencies across files.

Example cycle that caused the crash:

- File A: helper calls File B helper with a parameter
- File B: helper calls File A helper with a parameter
- Without shared visitedSymbolIds, the cycle is not detected

The fix preserves `visitedSymbolIds` across context switches. Symbol IDs are globally unique across all analyzed files in the same run, so there is no risk of collision.
