---
"oxlint-plugin-react-doctor": patch
---

Resolve runtime `React` bindings in classic JSX with the shared lexical scopes. JSX using a local catch binding no longer warns, and the rule still reports JSX that only has access to a type or to a binding outside its scope.
