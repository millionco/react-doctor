---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix `js-length-check-first` missing length guards in larger `&&` chains.
Previously the rule only consulted the immediate logical-expression
parent's `left` operand, so a shape like
`shouldCompare && a.length === b.length && a.every((value, index) => value === b[index])`
fired the warning even though the length comparison short-circuits
`.every()`.

The rule now walks up through `&&` ancestors (and transparently through
`||`, `??`, and `ChainExpression` wrappers so an outer `&&` guard stays
visible without claiming `||` operands are pre-conditions), flattens the
collected `&&` chain into individual operands, and requires a guard
operand to be an `===`/`==` `BinaryExpression` whose two `length`
member objects structurally match the `.every()` receiver and the array
indexed inside the callback. Operand order is symmetric, loose
equality is accepted, and `ChainExpression` wrappers are unwrapped so
`a?.length === b?.length && a?.every(...)` is recognised.

Negative cases still flag: missing guard, guard placed after `.every()`
(`a.every(...) && a.length === b.length`), guard comparing an
unrelated array (`a.length === c.length && a.every(..., b[i])`), and
inequality operators (`a.length >= b.length && ...`).
