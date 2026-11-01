---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid reporting a visibility-guarded state reset when sibling callbacks only write the same primitive reset value. Keep warnings for unguarded prop resets and writers that can change hidden state.
