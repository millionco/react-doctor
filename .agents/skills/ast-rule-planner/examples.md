# AST Rule Planner Examples

## Detector Precision Examples

| Precision   | Use When                                          | Example                                                           |
| ----------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| Syntax-only | The bug is local and does not depend on identity. | `dangerouslySetInnerHTML={{ __html: value }}`                     |
| Scope-aware | Names must resolve to imports or local bindings.  | `useReducer` must be React's import, not a local function.        |
| Path-aware  | Order and branches decide correctness.            | `return state` is valid unless the same path mutated state first. |

## Example Plan: `no-mutating-reducer-state`

AST vocabulary:

| Node                                              | Why it matters                                           |
| ------------------------------------------------- | -------------------------------------------------------- |
| `ImportDeclaration`                               | Find React imports.                                      |
| `ImportSpecifier`                                 | Detect `useReducer` aliases.                             |
| `CallExpression`                                  | Find `useReducer(...)` and mutating method calls.        |
| `FunctionDeclaration` / `ArrowFunctionExpression` | Resolve same-file reducer bodies.                        |
| `AssignmentExpression`                            | Detect `state.x = y`.                                    |
| `UpdateExpression`                                | Detect `state.x++`.                                      |
| `ReturnStatement`                                 | Decide whether the original state reference is returned. |
| `IfStatement` / `SwitchStatement`                 | Keep path-specific mutation state.                       |

Pseudocode:

```ts
collectReactUseReducerBindings(program)

for each CallExpression:
  if not React useReducer call:
    continue

  reducerFunction = resolveSameFileReducer(call.arguments[0])
  if reducerFunction is null:
    continue

  stateParameter = first reducer parameter
  analyze reducer statements by path:
    track names pointing to original state
    track mutations of original state
    report mutations only when same path returns original state
```

V1 non-goals:

- Imported reducer bodies.
- Helper-call mutation.
- Destructured aliases.
- Full loop/try/catch control flow.
- Draft reducers from Immer or Redux Toolkit.

## Example Plan: Inline Object Literal Into Memoized Component

Detector precision:

- Scope-aware.
- Not path-aware for v1.

Pseudocode:

```ts
collect React memo bindings
collect local components created by React.memo or memo

for each JSXAttribute:
  if containing JSX element is not a known memoized component:
    continue

  if attribute value is ObjectExpression after stripping wrappers:
    report
```

False-positive traps:

- DOM elements.
- Non-memoized components.
- Imported components not proven memoized.
- `React.memo(Component, customComparator)`.
- Stable identifier props.
