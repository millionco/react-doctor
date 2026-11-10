---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Report a timer that a named async function scheduled by `useEffect` creates after an `await` without checking an effect-local lifecycle guard, such as `const load = async () => { await fetch(url); timer = setTimeout(...) }; void load();`. The cleanup can run before the timer exists, so clearing the stored handle does not release it. The same code written as an async IIFE was already reported. A timer created before the first `await`, or one behind a guard that the cleanup invalidates, stays accepted. Guarded async work that restarts itself stays reported, as in #1762.
