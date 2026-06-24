---
"react-doctor": patch
---

Make `browser eval` and `browser eval --profile` self-reporting about what an action did to the page. A driven action that triggers a page-side error (a `console.error` or an uncaught throw) now appends an "Errors during eval" section instead of failing silently, so a broken interaction surfaces without hand-wiring a console hook. `--profile` (and the `browser_profile` MCP tool) now reports page geometry alongside memory — viewport size, devicePixelRatio, scroll offset, and how far the page scrolled while the action ran — so "did the element move, or did the page scroll under me?" is answerable from the output. Page scroll delta only prints when the viewport actually moved.
