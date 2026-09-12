---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Stop reporting local service `.use()` methods as React hooks. Preserve diagnostics for React namespace calls, including aliases and CommonJS imports.

Only recommend `setAnimationLoop` when a recursive animation frame callback renders through a known Three.js renderer. Leave independent 2D canvas and DOM loops alone, including files that also import Three.js.
