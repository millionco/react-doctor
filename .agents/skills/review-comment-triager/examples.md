# Review Comment Triager Examples

## Fix Now: Dynamic Computed Member

Comment:

```md
`getStaticMemberPropertyName` does not check `computed`, so `state[push]()` can be treated as `state.push()`.
```

Classification:

- Fix now.

Reason:

- Real false-positive bug.
- Dynamic property names should not match static mutator names.

Required regression test:

- `state.items["push"](...)` reports.
- `state.items[push](...)` does not report.

## Fix Now: Switch Fallthrough

Comment:

```md
Switch cases are analyzed independently, so mutations in a fallthrough case are not carried into later returns.
```

Classification:

- Fix now.

Reason:

- Real false negative for claimed path behavior.

Required regression test:

- Fallthrough mutation into `return state` reports.
- `break` prevents carrying mutation to later cases.

## Defer: Imported Reducer Bodies

Comment:

```md
The rule does not inspect imported reducer implementations.
```

Classification:

- Document or defer.

Reason:

- Import-following is outside v1 scope.
- Guessing would risk false positives and stale module resolution behavior.

Required action:

- Ensure imported reducer test stays quiet.
- Add TODO only if maintainers want v2 import-following.

## Reject: Broaden to All Reducer Mutation

Comment:

```md
This should flag nested mutation even when returning `{ ...state }`.
```

Classification:

- Reject or split into future rule.

Reason:

- Different bug and different diagnostic wording.
- React receives a new top-level object, so it is not the same-reference return rule.
