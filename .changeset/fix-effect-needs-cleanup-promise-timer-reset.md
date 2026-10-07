---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

fix(effect-needs-cleanup): accept Promise timer that resets its own handle in callback

Fixes #1882. The rule no longer flags a timer created in a Promise callback when the timer's own callback resets the handle to `null` or `undefined`. This is safe because the timer has already fired when the reset happens, so no live handle is lost.
