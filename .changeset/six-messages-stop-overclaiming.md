---
"oxlint-plugin-react-doctor": patch
---

Reword six diagnostic messages that asserted concrete runtime harm on trigger shapes where the harm does not occur: no-render-in-render (plain render-helper calls do not remount or lose state), no-direct-state-mutation (a setter call after the mutation still redraws), no-direct-mutation-state (setState after the mutation still redraws), server-no-mutable-module-state (a never-written module `let` leaks nothing), query-mutation-missing-invalidation (invalidation can happen at the mutate() call site), and rn-no-dimensions-get (a Dimensions.get() read inside an event handler is fresh, not stale).
