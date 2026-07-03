---
"oxlint-plugin-react-doctor": patch
---

fix(react-builtins): `only-export-components` no longer flags components
declared inside another function — a test callback (`test("x", () => { const
Harness = () => ... })`), a factory (`function setup() { const Row = () =>
... }`), or an object-literal `render` method. Those are never Fast Refresh
boundaries, so the "not exported" / "file exports nothing" messages told
users to export values that can't be exported. The local-component walk now
stays at module scope, matching the origin rule in
eslint-plugin-react-refresh. Found by the fuzz FP oracle.
