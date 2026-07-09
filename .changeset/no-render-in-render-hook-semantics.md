---
"oxlint-plugin-react-doctor": patch
---

`no-render-in-render` now requires React-component semantics before firing: it only reports an inline `render*()` call when the callee resolves to a local function whose body calls hooks (a component in disguise, whose hooks get spliced into the caller's hook order). Hook-free render helpers that merely return JSX (inline call == inline JSX, nothing to lose) and class methods (`this.renderHeader()` — methods cannot call hooks) are no longer flagged.
