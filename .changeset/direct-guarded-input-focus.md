---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid suggesting a render-time reset when a local effect focuses a live input before resetting state, including when the helper guards the ref directly.
