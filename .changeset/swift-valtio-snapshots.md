---
"oxlint-plugin-react-doctor": patch
---

Add `valtio-no-proxy-read-in-render` to detect render-time reads from a Valtio proxy after the same proxy has been passed to `useSnapshot`, while preserving valid proxy reads in callbacks and mutation targets.
