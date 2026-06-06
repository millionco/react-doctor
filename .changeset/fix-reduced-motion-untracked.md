---
"react-doctor": patch
---

Fix false positive in `require-reduced-motion`: the check now searches untracked files so newly created source (e.g. a `providers.tsx` with `<MotionConfig reducedMotion="user">` not yet committed) is detected.
