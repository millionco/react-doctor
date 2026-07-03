---
"oxlint-plugin-react-doctor": patch
---

no-reset-all-state-on-prop-change: stop flagging effects whose state setters only run inside listener / observer / subscription callbacks — those reset on the external event, not on the prop change.
