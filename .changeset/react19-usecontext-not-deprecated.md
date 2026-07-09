---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

no-react19-deprecated-apis no longer flags `useContext`. React 19's `use()` is an additive alternative — `useContext` remains a fully supported, non-deprecated API, so calling it deprecated was misinformation. The rule still flags `forwardRef` (both named imports and `React.forwardRef` member access) on React 19+ projects.
