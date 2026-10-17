---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Preserve await ordering when a directly passed local callback may publish into the same local object read by a later early-return guard. Retain diagnostics for unrelated object reads and unsupported callback or binding shapes.
