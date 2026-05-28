---
name: preact-signals-preact-integration
description: Use when working with @preact/signals in Preact components, including useSignal, useComputed, useSignalEffect, direct JSX signal rendering, DOM attribute optimization, Show, For, useLiveSignal, and rerender behavior.
---

# Preact Signals Preact Integration

## Core Approach

In Preact, reading `signal.value` during component render subscribes the component. Passing a signal object directly as JSX text or a supported DOM attribute can skip component rerenders and update the DOM directly.

## Component State

Create component-local signals with hooks, not `signal()` in render:

```tsx
import { useSignal, useComputed, useSignalEffect } from "@preact/signals";

function Counter() {
  const count = useSignal(0);
  const double = useComputed(() => count.value * 2);

  useSignalEffect(() => {
    console.log(count.value);
  });

  return <button onClick={() => count.value++}>{double}</button>;
}
```

Calling `signal()` in a component body creates a new signal on every render — use `useSignal()` so the signal persists across renders.

## Rendering Choices

Use `.value` when component rerender semantics are desired:

```tsx
function Counter() {
  return <p>Count: {count.value}</p>;
}
```

Pass the signal directly when direct DOM updates are desired:

```tsx
function Counter() {
  return <p>Count: {count}</p>;
}
```

Preact also supports experimental direct signal DOM attributes:

```tsx
const inputValue = signal("Ada");

function NameField() {
  return <input value={inputValue} onInput={e => (inputValue.value = e.currentTarget.value)} />;
}
```

Do not apply the React adapter limitation to Preact; React does not support signal DOM attributes, but Preact does.

## Show And For

`Show` and `For` optimize around signals. They should not be used to smuggle non-signal parent values into cached children.

```tsx
const showDetails = useSignal(false);
const items = useSignal<Item[]>([]);

function App() {
  return (
    <For each={items}>
      {item => <Item item={item} showDetails={showDetails} />}
    </For>
  );
}

function Item({ item, showDetails }: { item: Item; showDetails: Signal<boolean> }) {
  return <li>{item.id}{showDetails.value && ` - ${item.createdAt}`}</li>;
}
```

If existing `For` children do not react to parent values, pass signals down or lift the child into a component. That behavior is intentional — rerendering on arbitrary non-signal changes would remove much of `For` and `Show`'s value.

## useLiveSignal

Use `useLiveSignal` when a component receives a signal reference that may itself change, or when a one-time model constructor needs a live reactive input:

```tsx
import { useLiveSignal } from "@preact/signals/utils";

function Detail({ selected }: { selected: Signal<string> }) {
  const liveSelected = useLiveSignal(selected);
  const model = useModel(() => new DetailModel(liveSelected));
  return <DetailView model={model} />;
}
```

This guards against stale signal references when the parent swaps which signal it passes in.

## Common Mistakes

- Using `signal()` inside a component body instead of `useSignal()`.
- Expecting object property mutation to notify subscribers.
- Assuming `For` reruns children for non-signal parent variables.
- Reading `.value` in JSX when direct text-node optimization was intended.
- Passing direct signal DOM attributes in React because it worked in Preact.

## References

- Package docs: `node_modules/@preact/signals/README.md`
- Online: https://github.com/preactjs/signals/blob/main/packages/preact/README.md
- Utilities: https://github.com/preactjs/signals/blob/main/packages/preact/utils/README.md
