# Rule Scope Guard Examples

## Belongs in V1

```tsx
state.count++;
return state;
```

Reason:

- Mutates original state.
- Returns original top-level state reference.
- Matches diagnostic wording.

## Separate Future Rule

```tsx
state.user.name = "Ada";
return { ...state };
```

Reason:

- Mutates nested state.
- Returns a new top-level object.
- Requires different wording and false-positive handling.

## Skip for V1

```tsx
mutateState(state);
return state;
```

Reason:

- Requires interprocedural analysis.
- Too easy to guess wrong.
- Add TODO or separate future scope.

## Diagnostic Wording Alignment

Good:

```md
Do not mutate reducer state and return the same state object.
```

Bad:

```md
Reducers must never mutate state.
```

Reason:

- The bad wording claims broader behavior than v1 detects.
- It would imply nested mutation, Immer draft mutation, and clone-first mutation are all invalid.
