---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Keep DOM visibility writes quiet when a workspace ref helper forwards the host element unchanged into state. Recheck workspace providers between scans and avoid replaying whole scan results for workspace consumers.
