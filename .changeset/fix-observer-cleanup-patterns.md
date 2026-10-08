---
"oxlint-plugin-react-doctor": patch
---

Accept observer cleanup after tuple loops and a single animation-frame retry chain when cleanup disconnects the observer and cancels the pending frame. Require observer cleanup on every path and keep target-specific `unobserve()` checks.
