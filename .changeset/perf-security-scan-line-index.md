---
"oxlint-plugin-react-doctor": patch
---

perf: replace the security scan's per-match O(content) slice+split in `getLocationAtIndex` with a memoized per-content line-start index answered by binary search
