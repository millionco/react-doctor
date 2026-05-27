# Rule Implementation Review Examples

## False Positive: Dynamic Computed Member

Problem:

```tsx
state.items[push](item);
```

Risk:

If the detector reads `property.name === "push"` without checking `computed`, it treats a dynamic variable as static `state.items.push`.

Fix:

- Return static property names for `state.items.push`.
- Return static string names for `state.items["push"]`.
- Return `null` for `state.items[push]`.

Regression test:

- Static string computed mutator reports.
- Dynamic computed mutator does not report.

## False Negative: Transparent Wrappers

Problem:

```tsx
state.items!.push(item);
return state as State;
```

Risk:

The rule misses mutations or returns hidden behind TypeScript or parenthesized wrappers.

Fix:

- Strip transparent wrappers before checking member roots and return expressions.

Regression test:

- `state.items!.push(...)` plus `return state as State` reports.
- `return (state)` is treated like `return state`.

## Control Flow: Switch Fallthrough

Problem:

```tsx
switch (action.type) {
  case "mutate":
    state.count++;
  case "done":
    return state;
}
```

Risk:

Analyzing each case independently misses mutation flowing into later cases.

Fix:

- Model each possible starting case.
- Carry statements forward until a `break`.

Regression test:

- Fallthrough mutation into `return state` reports.
- A `break` prevents mutation from carrying into later cases.

## Scope: Block Rebinding

Problem:

```tsx
{
  state = { ...state };
}
state.count++;
return state;
```

Risk:

If block handling discards rebinding, the rule may think `state` still points to original state.

Fix:

- Preserve outer identity changes across standalone blocks.
- Do not leak `let`/`const` aliases out of block scope.

Regression test:

- Rebinding state to a clone inside a block stays valid.
- `var alias = state` inside a block can still leak and should be modeled.
