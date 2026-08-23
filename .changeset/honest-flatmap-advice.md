---
"oxlint-plugin-react-doctor": patch
---

Stop recommending `flatMap` as a guaranteed performance improvement for `.map().filter(Boolean)`. The rule now suggests a single-pass `reduce` or `for...of` rewrite only for measured hot paths.
