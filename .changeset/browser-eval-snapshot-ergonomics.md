---
"react-doctor": patch
---

Make `browser eval` the one primitive for driving a page: when an expression just acts (returns nothing), it now hands back the resulting accessibility tree, so a single call both drives the page and shows the new state — no follow-up `snapshot`. Multi-statement source works without hand-wrapping it in an async IIFE, and a page-context `ReferenceError` (`window is not defined`) now explains that `eval` runs in Node with the Playwright `page` in scope and to reach page globals through `page.evaluate(() => …)`. The same applies to the `browser_eval` MCP tool. Locating stays pure Playwright — `browser snapshot`, or `page.locator(...).ariaSnapshot()` inside `eval` for a subtree.
