---
"oxlint-plugin-react-doctor": patch
---

`no-adjust-state-on-prop-change` is demoted from error to warn. It was the lone error-severity member of the derived-state family (`no-derived-state-effect` et al. are all warn), co-fires with them on the same effect, and shares their main false-positive failure mode (flagging non-derivable interactive/env/draft/handshake state). It now matches the family until precision improves.
