---
name: preact-signals-core
description: Use when implementing or debugging @preact/signals-core, signal, computed, effect, batch, untracked, action, createModel, signal.value tracking, object or array updates, and reactivity that appears stale or over-eager.
---

# Preact Signals Core

## Core Model

Signals are runtime-tracked containers. A reactive scope subscribes only to `.value` reads that actually execute during that run. Signals are not deep proxies; changing a property inside the current value does not notify subscribers unless a new `.value` is assigned.

## Creation And Reads

```ts
import { signal, computed, effect, batch, untracked } from "@preact/signals-core";

const count = signal(0);
const double = computed(() => count.value * 2);

effect(() => {
  console.log(double.value);
});

count.value = 1;
```

Use `.peek()` or `untracked()` only when a read must not become a dependency:

```ts
effect(() => {
  const next = count.value + untracked(() => offset.value);
  total.value = next;
});
```

## Runtime Tracking

Reads behind a non-reactive early return are not tracked if that path does not execute:

```ts
// Bad: states.value is not tracked until id exists.
effect(() => {
  const id = currentAction.peek().id;
  if (!id) return;
  console.log(states.value[id]);
});

// Better: read the signal before the guard if it should be a dependency.
effect(() => {
  const allStates = states.value;
  const id = currentAction.peek().id;
  if (!id) return;
  console.log(allStates[id]);
});
```

## Updating Objects And Arrays

Assign a new reference when the value is an object or array:

```ts
// Bad: no signal write occurs.
todos.value.push(todo);
profile.value.name = "Ada";

// Good.
todos.value = [...todos.value, todo];
profile.value = { ...profile.value, name: "Ada" };
```

Use `batch()` when several writes represent one logical update:

```ts
batch(() => {
  firstName.value = "Ada";
  lastName.value = "Lovelace";
});
```

## Computeds And Effects

- Keep `computed()` pure. Derive and return a value; do not write to other signals inside it.
- Use `effect()` for side effects and cleanup.
- Avoid returning fresh signals or mutable identity-sensitive objects from a computed unless stable identity is intentionally irrelevant.
- Use `action(fn)` when model methods should run batched and untracked.

## Quick Diagnosis

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| Value changes but UI stays stale | Property mutation inside `.value` | Assign a new object or array |
| Effect never reruns | `.value` read did not execute | Move the `.value` read before the guard |
| Condition always true | Checked the signal object | Check `signal.value` |
| Computed loops or throws | Write inside `computed` | Move write to `effect` or action |
| Multiple updates propagate separately | Separate writes | Wrap in `batch` |

## References

- Package docs: `node_modules/@preact/signals-core/README.md`
- Online: https://github.com/preactjs/signals/blob/main/packages/core/README.md
