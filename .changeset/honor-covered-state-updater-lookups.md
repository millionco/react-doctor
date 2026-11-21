---
"oxlint-plugin-react-doctor": patch
---

Recognize a closed local lookup used by a React state updater in curated exhaustive-deps when the effect declares the exact receiver. The rule still reports missing dependencies for other captures.
