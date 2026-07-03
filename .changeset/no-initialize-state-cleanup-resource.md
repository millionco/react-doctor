---
"oxlint-plugin-react-doctor": patch
---

no-initialize-state: stop flagging mount effects that seed state from a resource their cleanup disposes. When the setter argument derives from an effect-local binding referenced by the returned cleanup (`const audioContext = new AudioContext(); setGainNode(audioContext.createGain()); return () => audioContext.close();` — same shape for WebSockets, editors, observers), the effect owns a resource lifecycle and the value cannot be hoisted into `useState(initial)` because render has no matching dispose slot. Deterministic inits beside an unrelated cleanup (`setCount(42)` next to a `clearInterval` cleanup) keep firing.
