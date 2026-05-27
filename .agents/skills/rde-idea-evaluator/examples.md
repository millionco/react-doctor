# RDE Idea Evaluator Examples

## Evidence Classification

Strong positive:

```tsx
function reducer(state, action) {
  state.items.push(action.item);
  return state;
}
```

Classification:

- Exact target bug.
- React state identity issue.
- Use as invalid fixture.

Pattern-adjacent:

```tsx
state.user.name = "Ada";
return { ...state };
```

Classification:

- Nested mutation issue.
- Not same top-level reference return.
- Separate future rule, not v1.

False-positive trap:

```tsx
const next = { ...state };
next.count++;
return next;
```

Classification:

- Clone-first mutation.
- Should stay quiet.
- Use as valid fixture.

Out of scope:

```tsx
import { reducer } from "./reducer";
useReducer(reducer, initialState);
```

Classification:

- Imported reducer body.
- Skip for v1 unless import following is implemented.

## Output Example

```md
Summary:
The rule idea is valid, but exact positives are sparse and false-positive traps are common.

Detector implication:
Require React `useReducer`, same-file reducer resolution, alias tracking, and same-path same-reference return.

V1 non-goals:
Imported reducer bodies, helper-call mutation, nested mutation with fresh top-level return, Immer/RTK drafts.
```
