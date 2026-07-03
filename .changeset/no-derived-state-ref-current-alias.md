---
"oxlint-plugin-react-doctor": patch
---

no-derived-state (and the shared post-mount-read detector): recognize layout measurements read through a local alias of a ref's `.current` (`const el = contentRef.current; setX(el.scrollHeight > max)`) as deferred DOM measurements, not derived state.
