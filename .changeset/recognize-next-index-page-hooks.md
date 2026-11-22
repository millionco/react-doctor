---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Recognize a lowercase default export as a component when a standard Next.js index route renders it through a verified App. Preserve diagnostics for direct calls, unsupported renderers and invalid Hook order.

Report ordinary calls to imported pages at the caller. Refresh cached diagnostics when a page, re-export, or renderer changes.
