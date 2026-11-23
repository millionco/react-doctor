---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid an exhaustive-deps loop warning when a guarded effect has reached a terminal state and every verified JSX caller omits the prop needed to leave it. Track incoming caller and compiler changes when reusing scan results.
