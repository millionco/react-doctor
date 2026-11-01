---
"oxlint-plugin-react-doctor": patch
---

Detect missing cleanup for native timers called through globalThis, window, self, global, and proven constant aliases. Recognize matching qualified clearInterval and clearTimeout calls while preserving shadowed receiver and timer handle checks. Exclude qualified timer methods that have been overwritten, deleted, or updated, and never count an overridden clear method as cleanup.
