---
"oxlint-plugin-react-doctor": patch
---

`no-jsx-element-type` is demoted from error to warn. It fires on `JSX.Element` return-type annotations — a type-hygiene preference, not a runtime bug — so it must not block a scan at error severity.
