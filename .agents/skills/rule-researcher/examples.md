# Rule Researcher Examples

## Evidence Categories

Strong positive:

- Official docs or real code show the exact bug.
- The fix matches the proposed diagnostic.
- The code is tied to the target framework/library behavior.

Pattern-adjacent:

- The code is suspicious but not the same bug.
- It may need a separate rule.

False-positive trap:

- The code looks like the target bug but is valid.
- It should become a valid test fixture.

Out of scope:

- The rule would need type information, import following, or interprocedural analysis that v1 does not support.

## Example Research Summary

```md
Evidence:

- React docs show direct reducer mutation plus `return state`.
- React identity comparison explains the runtime failure.
- OSS scans found many valid mutation-looking cases.

False-positive traps:

- Clone-first mutation.
- Immer draft mutation.
- No-op `return state`.
- Nested mutation with fresh top-level return.

Detector implication:
Require React `useReducer`, same-file reducer resolution, path-aware mutation before same-reference return.
```
