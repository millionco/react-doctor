---
"oxlint-plugin-react-doctor": patch
---

Fix two `no-dead-assignment` false positives surfaced by running the rule across the OSS corpus.

- **Loop-carried state machines.** An unlabeled `break` inside a `switch` nested in a loop was routed to the loop's exit instead of the switch's merge, so a value written in a `case` and read at the top of the next iteration looked dead. The CFG builder now resolves an unlabeled `break` to the innermost enclosing loop **or** switch (matching JS semantics), keeping the loop's back-edge intact. Real repro: tldraw's `reorderShapes` state machine flagged `state = …` as dead on every iteration.
- **Values read only on an exceptional path.** A value assigned inside a `try` body — including a nested `catch` within it — and read only in the enclosing `catch`/`finally` was reported as dead, because the CFG models the exception path coarsely. `no-dead-assignment` now treats writes inside a `try` body as live. Real repro: bippy's `owner-stack` `control = caughtError`, read in the outer `catch`.

The `break`/`switch` control-flow fix also makes loop-membership and reachability correct for any code after a `switch` `break` inside a loop, which the other control-flow-graph-backed rules consume.
