---
name: preact-options-hooks
description: Preact guidelines to use the global options hooks for extending preact.
---

# Preact Options Hooks

Preact exposes a mutable `options` object (`import { options } from 'preact'`) that acts as a global hook system into the rendering pipeline. Any tool, library, or devtool can monkey-patch these hooks to observe or intercept every phase of the diff/commit cycle — no fibers, no DevTools protocol, no `bippy`.

## How to chain hooks

Always save the previous value before overwriting so other plugins (and Preact's own debug addon) keep working:

```ts
import { options } from 'preact';

const prev = options.diffed;
options.diffed = (vnode) => {
  // your logic
  prev?.(vnode);
};
```

To unhook, never restore the saved reference as other plugins might get lost. Instead, use a bail flag so the options chain stays intact:

```ts
let active = true;
const prev = options.diffed;
options.diffed = (vnode) => {
  if (active) {
    // your logic
  }
  prev?.(vnode);
};

// To stop observing without breaking other plugins:
active = false;
```

## Available hooks and their fire order

During a single render cycle the hooks fire in this order:

| Hook | Mangled name | Fires when | Signature |
|---|---|---|---|
| **before-diff** | `options.__b` | Just before a VNode starts diffing (called for *every* VNode, host and component). Good place to detect start of a commit batch. | `(vnode: VNode) => void` |
| **before-render** | `options.__r` | Immediately before a *component* VNode's `render()` / function body executes. Best place to start a performance timer. | `(vnode: VNode) => void` |
| **diffed** | `options.diffed` | After a VNode (and all its children) have been diffed. The DOM is updated at this point. Best place to stop a timer and read the resulting DOM. | `(vnode: VNode) => void` |
| **commit** | `options.__c` | After the entire tree's diff is done and the commit queue is about to flush (lifecycle methods / effects). Signals end of a commit batch. | `(vnode: VNode, commitQueue: Component[]) => void` |
| **unmount** | `options.unmount` | Before a VNode is removed from the tree. | `(vnode: VNode) => void` |
| **hook** | `options.__h` | When a hook (useState, useEffect, etc.) is invoked inside a component. `hookType` is an integer identifying the hook kind. | `(component: Component, index: number, hookType: number) => void` |

### Less common hooks

| Hook | Mangled name | Purpose |
|---|---|---|
| `options.vnode` | `options.vnode` | Called when a VNode is created (`createElement` / JSX). Can mutate the vnode. |
| `options.event` | `options.event` | Called before DOM events are processed. |
| `options.debounceRendering` | `options.debounceRendering` | Called so renders can be batched, by default this is `queueMicrotask`. |

## Accessing internal VNode properties

Preact 10.x mangles internal properties. The key ones on a VNode:

| Property | Mangled | Type | Meaning |
|---|---|---|---|
| component | `__c` | `Component \| null` | The class/function component instance |
| dom | `__e` | `Element \| Text \| null` | First DOM node produced by this VNode |
| children | `__k` | `VNode[] \| null` | Child VNodes |
| parent | `__` | `VNode \| null` | Parent VNode |
| flags | `__b` | `number` | Internal diff flags / start offset |
| index | `__i` | `number` | Index in parent's children array |

Specifically for `flags`, they have a certain bit-wise meaning, where `1<<7` means that the vnode is suspended and `1<<5` means that the node is hydrating.

## Accessing internal Component properties

| Property | Mangled | Type | Meaning |
|---|---|---|---|
| vnode | `__v` | `VNode` | The VNode this component rendered |
| nextState | `__s` | `object` | Pending state (before commit) |
| dirty | `__d` | `boolean` | Whether component is queued for re-render |
| force | `__f` | `boolean` | Whether `forceUpdate()` was called |
| hooks | `__H` | `{ __: HookState[], __h: HookState[] } \| null` | Hooks state container. `__` is the ordered list; `__h` is pending effects. |

Each `HookState` has `__` (the current value) and `__H` (deps array, if applicable).

## Getting a component's display name

```ts
function getDisplayName(vnode) {
  const type = vnode.type;
  if (typeof type === 'string') return null; // host element like 'div'
  if (typeof type === 'function') {
    return type.displayName || type.name || null;
  }
  return null;
}
```

## Finding the DOM node for a component VNode

A component VNode's `__e` may be `null` (fragments, Providers, etc.). Walk the child VNode list:

```ts
function getDOMNode(vnode) {
  if (vnode.__e instanceof Element) return vnode.__e;
  for (const child of vnode.__k || []) {
    if (child?.__e instanceof Element) return child.__e;
  }
  return null;
}
```

## Detecting mount vs update

A component is mounting if there is no previous props snapshot / no `alternate`. The simplest approach: track whether you've seen the component instance before (e.g., via a WeakMap or a custom property on the `vnode.__c`).

## Commit batching

`options.__b` fires for every VNode in a diff pass. The first call marks the start of a commit. `options.__c` fires once at the end with the full commit queue. This lets you implement `onCommitStart` / `onCommitFinish` semantics.

## Important notes

- These hooks are **synchronous** — they run inline during diffing. Keep them fast.
- `options.__b` fires for *all* VNodes (host elements too), not just components. Filter with `typeof vnode.type === 'function'` when you only care about components, `string` for dom-nodes or null for text-nodes.
- The mangled names (`__b`, `__r`, `__c`, `__h`, `__e`, etc.) are stable across Preact 10.x and are the canonical way to access internals — Preact's own addons (`preact/debug`, `preact/devtools`) use them.
- `options.diffed` fires bottom-up (children before parents). `options.__b` fires top-down.
- Always chain (save + call previous hook) to avoid breaking other addons.

Some examples of real-world usage:

- [preact/hooks](https://github.com/preactjs/preact/tree/v10.x/hooks/src/index.js)
- [@preact/signals](https://github.com/preactjs/signals/tree/main/packages/preact/src/index.ts)
- [preact-suspense](https://github.com/JoviDeCroock/preact-suspense/tree/main/src/suspense.ts)