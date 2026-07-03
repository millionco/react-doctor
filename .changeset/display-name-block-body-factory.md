---
"oxlint-plugin-react-doctor": patch
---

display-name: a curried component factory now reports consistently whether the outer arrow uses an expression body (`(order) => (props) => <X />`) or a block body with an explicit return — the block-body shape was silently skipped (found by the metamorphic arrow-body fuzz oracle).
