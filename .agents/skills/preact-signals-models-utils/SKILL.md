---
name: preact-signals-models-utils
description: Use when designing or debugging Preact Signals models and utilities, including createModel, useModel, action methods, Show, For, useLiveSignal, useSignalRef, nested model state, and model lifecycle disposal.
---

# Preact Signals Models And Utils

## Core Approach

Use models for cohesive signal state plus actions. A model should contain signals, actions, and nested objects containing only signals and actions. `useModel()` creates one model instance for a component lifetime and disposes it on unmount.

## createModel Pattern

```tsx
import { createModel, signal, computed } from "@preact/signals";

const CountModel = createModel((initialCount: number) => {
  const count = signal(initialCount);
  const double = computed(() => count.value * 2);

  return {
    count,
    double,
    increment() {
      this.count.value++;
    }
  };
});
```

Model functions are wrapped as actions, so they run batched and untracked.

## useModel Pattern

Use the model constructor directly only when it takes no arguments:

```tsx
function Counter() {
  const model = useModel(CountModelWithoutArgs);
  return <button onClick={model.increment}>{model.count}</button>;
}
```

Wrap constructors with arguments in a factory:

```tsx
function Counter() {
  const model = useModel(() => new CountModel(5));
  return <button onClick={model.increment}>{model.count}</button>;
}
```

`useModel()` ignores factory changes after the initial render. If constructor inputs can change and the model must react to them, pass a signal such as `useLiveSignal(inputSignal)` into the model and observe it inside the model.

## State Shape

- Store mutable UI state in signals.
- Store derived values in computed signals.
- Put writes in action methods or effects, not computed callbacks.
- Update arrays and objects by assigning new references.
- Keep async loading methods responsible for loading/error signals together with the data they update.

```tsx
const ListModel = createModel(() => {
  const items = signal<Item[]>([]);
  const loading = signal(false);

  return {
    items,
    loading,
    async load() {
      loading.value = true;
      try {
        items.value = await fetchItems();
      } finally {
        loading.value = false;
      }
    },
    add(item: Item) {
      items.value = [...items.value, item];
    }
  };
});
```

## Utility Components

Use `Show` for signal-backed conditionals and `For` for signal arrays:

```tsx
import { For, Show } from "@preact/signals/utils";

function ItemList({ model }: { model: Model }) {
  return (
    <Show when={model.hasItems} fallback={<p>No items</p>}>
      <For each={model.items}>{item => <Item item={item} />}</For>
    </Show>
  );
}
```

For values inside `For` children that should keep updating after the child is cached, pass signals down or render a child component that reads the signal.

## Common Mistakes

- Passing `useModel(ModelWithArgs)` instead of `useModel(() => new ModelWithArgs(args))`.
- Expecting a changed factory function to recreate the model.
- Returning plain mutable values from a model where callers expect reactivity.
- Creating signals inside a computed returned by the model.
- Treating `For` as a normal array map that reruns on unrelated parent values.

## References

- Preact utilities: https://github.com/preactjs/signals/blob/main/packages/preact/utils/README.md
- React utilities: https://github.com/preactjs/signals/blob/main/packages/react/utils/README.md
