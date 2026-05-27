# Adversarial Test Designer Examples

## Output Format

```md
Invalid suite:

- Case name: expected `<n>` diagnostics.

Valid suite:

- Case name: expected `0` diagnostics.

Minimum regression matrix:

- Smallest set needed for v1.
```

## Example: Reducer State Mutation Rule

Invalid cases:

- Direct mutation plus `return state`: expected `1`.
- Simple alias mutation plus alias return: expected `1`.
- `return state.sort(...)` for array state: expected `1`.
- Switch fallthrough from mutation into `return state`: expected `1`.
- TypeScript wrapper: `return state as State`: expected `1`.

Valid false-positive traps:

- No-op `return state`: expected `0`.
- Mutation branch returns `{ ...state }`: expected `0`.
- Clone-first mutation: expected `0`.
- Non-React `Array.prototype.reduce`: expected `0`.
- Locally shadowed `useReducer`: expected `0`.
- Imported reducer skipped by v1: expected `0`.
- Immer/Redux Toolkit draft mutation: expected `0`.

## Example: Conditional Hook Calls

Invalid cases:

- `if (condition) useState()`: expected `1`.
- Early return before later hook: expected `1`.
- `condition && useEffect(...)`: expected `1`.
- Ternary with hooks in both branches: expected `2`.
- Hook inside loop body: expected `1`.
- React namespace import: `React.useState()`: expected `1` when conditional.

Valid false-positive traps:

- Conditional JSX after all hooks: expected `0`.
- Early return after all hooks: expected `0`.
- Conditional logic inside `useEffect` callback: expected `0`.
- Nested function containing hook when the outer rule does not own nested hooks: expected `0`.
- Non-hook function named `user`: expected `0`.
- Type-only reference to `typeof useState`: expected `0`.

Minimum matrix:

- Invalid direct `if`: `1`
- Invalid early return before hook: `1`
- Invalid ternary with two hook branches: `2`
- Invalid loop body: `1`
- Valid early return after hooks: `0`
- Valid callback-internal condition: `0`
- Valid non-hook `user()`: `0`
- Valid nested function trap: `0`
