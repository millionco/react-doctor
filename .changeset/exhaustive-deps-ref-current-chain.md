---
"oxlint-plugin-react-doctor": patch
---

fix(react-builtins): `exhaustive-deps` now truncates captured member chains at
`.current` (e.g. `textareaRef.current.style.height` → `textareaRef`), matching
upstream eslint-plugin-react-hooks. Previously an effect reading a prop-passed
ref reported mutable `.current` paths as "stale" dependencies and effectively
told users to add `ref.current.*` values to the deps array, which is never
valid. Found by corpus census triage.
