---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix `rn-no-raw-text` false positive on `<fbt>` children of text-wrapping custom components. The transparent wrapper check now sees through auto-detected and imported text wrappers, not just built-in text components, so `<Card><fbt>...</fbt></Card>` (where `Card` renders `<Text>{children}</Text>`) is correctly exempt. Fixes #1722.
