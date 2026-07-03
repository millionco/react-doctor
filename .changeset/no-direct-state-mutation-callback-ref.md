---
"oxlint-plugin-react-doctor": patch
---

no-direct-state-mutation: stop flagging in-place writes to a callback-ref target. When a `useState` setter is passed straight to a JSX `ref` attribute (`ref={setNode}`), the paired state holds a DOM element / component instance, so `node.dataset.x = ...` or `node.style.x = ...` is deliberate imperative DOM work, not a lost state update. The wangeditor `useState(null)` + effect-mutation bug (whose ref comes from a separate `useRef`) stays flagged.
