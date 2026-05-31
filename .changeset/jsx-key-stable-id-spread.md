---
"react-doctor": patch
---

`jsx-key` no longer reports a missing key when a list element spreads the whole iteration item — `items.map((item) => <Item {...item} />)`. Spreading the row object is the canonical "this row carries its own identity" shape and was the dominant source of `jsx-key` noise on real lists, while rarely catching a genuine reorder bug. Genuine keyless lists still report: `items.map((item) => <Item name={item.name} />)`, index keys, array literals (`[<Item {...item} />]`), and spreads of anything other than the iteration variable.
