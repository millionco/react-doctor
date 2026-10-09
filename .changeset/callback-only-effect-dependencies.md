---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Do not classify a local state transition as a prop-driven adjustment when its only prop dependencies are called notifications. Keep checks for prop values used in guards, results, or reset dependencies.
