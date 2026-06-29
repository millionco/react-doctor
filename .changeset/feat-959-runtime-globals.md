---
"@react-doctor/core": patch
---

Add `runtimeGlobals` config to silence jsx-no-undef false positives for runtime-injected identifiers

`jsx-no-undef` is a single-file rule, so it flags capitalized JSX identifiers
that are provided at runtime rather than imported in the file — react-live's
`<LiveProvider scope={...}>`, Storybook globals, MDX live blocks, or an ambient
`declare global` in a separate `.d.ts`. List those names in the new
`runtimeGlobals` config array and `jsx-no-undef` treats them as known. Opt-in —
an empty/absent list leaves behavior unchanged.

Closes #959
