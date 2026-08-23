---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Run `rerender-functional-setstate` natively in the patched Oxlint binding and avoid reporting a synchronous state update when the only other call to the same setter does not read that state.
