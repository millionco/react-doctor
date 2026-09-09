---
"react-doctor": patch
---

Detect React Compiler when `@vitejs/plugin-react` is called with an enabled `compiler` option (`react({ compiler: true })` or `react({ compiler: { ... } })`), including aliased, namespace, and CommonJS forms of the default export. `compiler: false` and unrelated objects with a `compiler` property stay undetected, so rules disabled under React Compiler now switch off for these Vite projects.
