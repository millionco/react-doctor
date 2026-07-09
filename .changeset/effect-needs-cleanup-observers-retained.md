---
"oxlint-plugin-react-doctor": patch
---

`effect-needs-cleanup` covers more leak shapes. Resource detection now includes DOM observers (`ResizeObserver` / `MutationObserver` / `IntersectionObserver` / `PerformanceObserver` — via their `.observe(...)` registration, released by `.disconnect()` / `.unobserve()`) and connections (`new WebSocket(...)` / `new EventSource(...)`, released by `.close()`; returning the socket handle itself is not cleanup). Cleanup analysis also runs on functions retained across renders (`useCallback` callbacks and component-scope handlers) with a stricter firing policy: a discarded `setInterval` id (unclearable), a discarded socket construction, or a discarded subscribe/observe registration in a file with no release-shaped call anywhere. One-shot `setTimeout` in handlers, `{ once: true }` / `{ signal }` listeners, captured handles, and functions that release their own resources stay unflagged.
