---
"oxlint-plugin-react-doctor": patch
---

`rules-of-hooks` no longer reports false positives for hooks called inside a `forwardRef(...)` / `memo(...)` render callback whose binding name is not PascalCase (e.g. `const _Wrapped = forwardRef((props, ref) => { useHook(); ... })`). The render callback passed directly to React's HoCs is a component by construction, so the rule now treats it as one regardless of the variable name it lands on. Genuinely non-component functions like `const _helper = () => { useState(); }` still report.
