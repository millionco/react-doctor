---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

`query-destructure-result` no longer classifies rest-destructuring (`const { data, ...rest } = query`) — that shape is `query-no-rest-destructuring`'s territory, and claiming it in both rules reported the same line twice (#1082). The rule now fires only on the consumption it uniquely owns: spreading the whole TanStack Query result into JSX (`<Inner {...query} />`) or an object literal, which enumerates every field and subscribes the component to all of them.
