---
"oxlint-plugin-react-doctor": patch
---

no-array-index-as-key: recognize composite keys whose per-item identity comes from a destructured callback field (`({ message }, index) => key={`${message} ${index}`}`) or a method call on the item (`key={`${index}-${color.toHexString()}`}`) — the index is just a uniqueness fallback there; composite keys with no item-derived part stay flagged. Also extend the static-placeholder exemption to `Array.from({length: values.length}, …)` and to numeric `for (let i = 0; …)` loop counters — both imperative twins of the already-exempt `Array(N)` placeholder; a manually incremented index over real items stays flagged.
