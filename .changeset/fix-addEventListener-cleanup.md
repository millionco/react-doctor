---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

fix(effect-needs-cleanup): recognize returned identifiers for addEventListener/addListener

Fixes #1558 (partial) - Resolves false positives when returning subscription handles from addEventListener/addListener.

The rule now correctly recognizes these cleanup patterns:
- `return unsubscribe` where `unsubscribe` holds an addEventListener result
- `return () => unsubscribe()` wrapper around the subscription handle

This addresses the primary false-positive pattern reported for React Native's `NetInfo.addEventListener` and similar APIs that return cleanup handles (either functions or objects with `.remove()`).

**Remaining work** (tracked separately):
- Cleanup delegated to effect-local helper functions  
- Array-collected subscription handles with forEach/for-of
