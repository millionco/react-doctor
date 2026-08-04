---
"oxlint-plugin-react-doctor": patch
---

Reduce default rule scan overhead by gating framework-specific visitors and skipping expensive analyses until their prerequisite syntax is present.
