---
"oxlint-plugin-react-doctor": patch
---

Add 7 new rules mined from React, web-platform, security, and accessibility best practices:

- `no-call-component-as-function` (Bugs): calling a component like `Foo(props)` instead of `<Foo />` runs it outside React and breaks hooks, state, and memoization. Shadow-safe via scope resolution.
- `no-create-ref-in-function-component` (Bugs): `createRef()` in a function component or hook allocates a fresh ref every render; use `useRef()`.
- `no-async-effect-callback` (Bugs): an `async` `useEffect`/`useLayoutEffect` callback returns a Promise that React treats as cleanup, causing unmount races.
- `no-json-parse-stringify-clone` (Performance): `JSON.parse(JSON.stringify(x))` is a slow, lossy deep clone; use `structuredClone(x)`.
- `no-img-lazy-with-high-fetchpriority` (Performance): `loading="lazy"` and `fetchPriority="high"` are contradictory directives on the same image.
- `dialog-has-accessible-name` (Accessibility): a `<dialog>` / `role="dialog"` with no `aria-label`/`aria-labelledby` is announced only as "dialog".
- `auth-token-in-web-storage` (Security): persisting auth tokens in `localStorage`/`sessionStorage` exposes them to XSS exfiltration.
