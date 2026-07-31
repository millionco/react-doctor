---
"oxlint-plugin-react-doctor": patch
---

Keep `no-create-ref-in-function-component` quiet when `createRef()` values are initialized once behind a stable `useRef().current` guard.
