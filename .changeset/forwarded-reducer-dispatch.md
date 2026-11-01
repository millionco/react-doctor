---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Report an unguarded `useReducer` dispatch after `await` or inside a microtask or Promise callback when it goes through a transparent local setter helper, such as `queueMicrotask(() => assign(dispatch, action))`, exactly where the direct dispatch is reported. Only `no-set-state-after-await-in-effect` accepts the forwarded dispatch, because it already counts a direct dispatch. The prop-change rules, which compare writes against `useState` initializers, stay unchanged. Imported, reassigned, asynchronous, deferred and conditional helpers, and reassigned dispatch bindings, stay outside the proof.
