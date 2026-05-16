---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix `js-combine-iterations` false positive on lazy ES2025 Iterator helper chains
(issue #205). Chains rooted in `<x>.values()` / `.keys()` / `.entries()` (on any
non-`Object` receiver — Maps, Sets, arrays, `URLSearchParams`, etc.),
`Iterator.from(<x>)`, or syntactically-declared generators in the same file
(`function* gen() {}` and `const gen = function*() {}`, hoisted use included)
are now recognised as single-pass and skipped.

The walk continues past chainable iteration methods (`map` / `filter` / `flatMap` /
`forEach`) so deeper nesting like `arr.values().map().filter()` is also covered,
and stops at materializing or unknown calls so eager array chains still fire —
including `Object.values(obj).map().filter()` (Object.\* returns arrays),
`arr.values().toArray().filter().map()` (`.toArray()` materialises), and
`Array.from(it).filter().map()`. The existing `.map().filter(Boolean)` and
`.map().filter(x => x)` exclusions are preserved.
