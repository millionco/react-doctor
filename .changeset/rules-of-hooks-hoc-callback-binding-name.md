---
"oxlint-plugin-react-doctor": patch
---

`rules-of-hooks` and `exhaustive-deps` no longer report false positives for hooks called inside a `forwardRef(...)` / `memo(...)` render callback whose binding name is not PascalCase (e.g. `const _Wrapped = forwardRef((props, ref) => { useHook(); ... })`). The render callback passed as the first argument to React's HoCs is a component by construction, so both rules now treat it as one regardless of the variable name it lands on. Only the first argument is promoted — hooks inside `memo`'s second argument (the props comparator) still report, as do genuinely non-component functions like `const _helper = () => { useState(); }`.
