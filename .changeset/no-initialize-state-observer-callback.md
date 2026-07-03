---
"oxlint-plugin-react-doctor": patch
---

no-initialize-state: stop flagging setters that only fire from a callback argument of an effect-local instance (`const observer = new MutationObserver((m) => setEntryCount(m.length)); observer.observe(...)`). The eventual-call resolver treated a callback passed to a constructor or factory as the binding's own call graph, so a method call on the instance counted as a synchronous setter call. Function-expression arguments of a binding's initializer call are now excluded from the resolver (hook wrappers like `useCallback(fn, deps)` still count, since calling the binding runs the wrapped function). Bare identifier arguments (`debounce(setN)`) are unaffected.
