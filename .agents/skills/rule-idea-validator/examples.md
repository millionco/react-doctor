# Rule Idea Validator Examples

## Good Rule Definition

```md
This rule catches React `useReducer` reducers that mutate the current state object and return that same object.
```

Why it is good:

- Names the framework surface: React `useReducer`.
- Names the code pattern: mutate current state and return same object.
- Names the bug boundary: same object/reference.

## Bad Rule Definition

```md
This rule catches bad reducer state updates.
```

Why it is bad:

- Too broad.
- Does not say which reducer API.
- Does not distinguish same-reference return from clone-first mutation.
- Does not imply clear false-positive boundaries.

## Example Output

```md
Rule definition:
This rule catches React `useReducer` reducers that mutate the current state object and return that same object.

Runtime reason:
React compares reducer state by reference. Returning the same mutated object can make React treat the update as unchanged.

Detector precision:
Scope-aware and path-aware.

In scope:

- React `useReducer` calls.
- Same-file reducer functions.
- Direct mutation of the original state parameter or simple alias.
- Same-path return of the original top-level state reference.

Out of scope:

- Imported reducer bodies.
- Immer or Redux Toolkit draft reducers.
- Nested mutation followed by a new top-level object.
- Helper calls like `mutate(state)` unless modeled later.

False-positive traps:

- No-op `return state`.
- Clone-first mutation.
- Non-React `Array.prototype.reduce`.
- Locally shadowed `useReducer`.

RDE:
Run idea validation because reducer-like code has many valid mutation-looking patterns.
```
