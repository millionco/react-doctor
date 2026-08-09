---
"@react-doctor/api": patch
"@react-doctor/core": patch
---

Reduce `diagnose({ projects })` wall time by inventorying sibling workspace projects once, reusing their sized source-file lists through discovery and lint planning, and scanning larger projects first while preserving result order.
