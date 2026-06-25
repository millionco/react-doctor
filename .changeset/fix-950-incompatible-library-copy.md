---
"@react-doctor/core": patch
---

Fix misleading remediation for react-hooks-js/incompatible-library

`react-hooks-js/incompatible-library` fires when the React Compiler can't
memoize through a third-party hook (e.g. `@tanstack/react-virtual`'s
`useVirtualizer`). The diagnostic carried the generic React Compiler action —
"Rewrite the flagged code so the compiler can optimize it" — which reads as
"reimplement the library locally" and steered users off mature libraries.

The rule stays active (the compiler's own bail-out reason is informative), but
its remediation now names the real fix: it's how the library works, not a bug in
your code — memoize values you pass from it into other memoized components, or
suppress it with `// react-doctor-disable-next-line react-hooks-js/incompatible-library`.

Closes #950
