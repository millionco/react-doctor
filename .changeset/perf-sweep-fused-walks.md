---
"oxlint-plugin-react-doctor": patch
---

perf: fused-walk sweep — ~13 repeated subtree traversals collapse into single passes or per-node memos (async-await-in-loop's triple walk and fixpoint pre-pass, js-cache/js-index-maps loop walks, rendering-usetransition's three detectors, display-name's per-candidate program scans, per-binding setter walks in the state/effect rules, and WeakMap memos for prop-name/bound-name/effect-count analyses)
