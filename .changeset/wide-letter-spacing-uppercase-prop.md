---
"react-doctor": patch
---

`no-wide-letter-spacing` no longer false-positives on uppercase labels styled through a wrapper component prop.

The rule exempts wide tracking on uppercase text, but it could only see `textTransform: 'uppercase'` written inline in the same style object. Design-system text components routinely apply the transform from a prop instead (`<SSText uppercase style={{ letterSpacing: 2 }}>`), which the rule can't see inside the component (#671). It now also treats a sibling `uppercase` boolean prop or a `textTransform="uppercase"` prop on the same element as the uppercase signal, so those short labels stay quiet.
