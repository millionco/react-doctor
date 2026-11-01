---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Report an unguarded state update after `await` or inside a microtask or Promise callback when it goes through a transparent local setter helper, such as `queueMicrotask(() => assign(setValue, next))`, exactly where the direct setter call is reported. Cleanup guards still protect the forwarded write. Imported, reassigned, asynchronous, deferred, conditional, and multi-statement helpers stay outside the proof. Preserve transparent TypeScript setter arguments and implicit undefined writes, and exclude bound/call/apply argument shifts from the forwarding proof.
