---
"oxlint-plugin-react-doctor": patch
---

perf: set-membership sweep — ~13 linear array scans on per-element hot paths now use Sets/Maps (ARIA element-role tables become O(1) lookup maps, event-handler presence checks collapse to one lowercased-Set pass per element, a11y settings lists and tanstack order tables convert to Sets/index Maps)
