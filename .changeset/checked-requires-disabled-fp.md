---
"oxlint-plugin-react-doctor": patch
---

fix(react-builtins): `checked-requires-onchange-or-readonly` no longer flags
statically disabled checkboxes (`<input type="checkbox" checked={x} disabled />`).
Users can't toggle a disabled input, so no `onChange` is needed — React's own
controlled-checkbox runtime warning exempts `disabled` the same way. A dynamic
`disabled={cond}` still reports, since the input can be enabled at runtime.
Found by corpus census triage.
