---
"oxlint-plugin-react-doctor": patch
---

`rerender-lazy-ref-init` no longer flags trivial empty-container constructors — `useRef(new Set())` / `new Map()` / `new WeakSet()` / `new WeakMap()` / `new AbortController()` cost about as much as the already-exempt coercion helpers, so recommending the lazy null-check ceremony for them was net-negative. The exemption list is now the shared `TRIVIAL_CONSTRUCTOR_NAMES` constant consumed by both `rerender-lazy-ref-init` and `rerender-lazy-state-init` (which also gains `WeakRef`). User-defined class constructors (`useRef(new HeavyModel(config))`) still fire.
