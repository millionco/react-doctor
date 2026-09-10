---
"oxlint-plugin-react-doctor": patch
---

Fix `three-prefer-set-animation-loop` false positive on 2D canvas animations

The rule now checks for Three.js imports (`three`, `@react-three/*`) before reporting recursive `requestAnimationFrame` loops. This prevents false positives on 2D canvas/DOM animations in projects that have Three.js as a dependency but don't use it in specific files.
