---
"oxlint-plugin-react-doctor": patch
---

`no-derived-state-effect` now recurses into `if` guards: wrapping the derived-state setter in `if (cond) setX(derive(dep))` (including if/else and braceless forms) no longer silences the rule. Branches containing non-setter work, early returns, or other non-expression statements still disqualify the effect, so guarded escape-hatch effects stay unflagged.
