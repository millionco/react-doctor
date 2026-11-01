---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

Report `react-hooks-js/set-state-in-effect` when an effect updates state synchronously through a transparent local setter helper, such as `useEffect(() => assign(setValue, next))`, which React Compiler does not follow. A new `forwarded-set-state-in-effect` rule finds the write with the forwarded setter proof, runs only when the compiler rule is enabled, and React Doctor reports its finding under the compiler's rule key, message and docs link, so `react-hooks/set-state-in-effect` disable comments, ignores and scoring treat it like the compiler finding. Effects with a direct setter call stay with the compiler, so nothing is reported twice. Imported, reassigned, asynchronous, deferred, conditional and multi-statement helpers stay outside the proof.
