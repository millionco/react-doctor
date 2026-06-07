---
"oxlint-plugin-react-doctor": patch
---

Stop flagging `rn-no-inline-flatlist-renderitem` on React Compiler projects.

React Compiler memoizes the `renderItem` value created in the component body, so its identity is stable across redraws and the rule is a false positive in compiler-enabled projects (#723). It now ships with `disabledBy: ["react-compiler"]`, matching the `jsx-no-new-*-as-prop` family.

The sibling rules `rn-list-callback-per-row` and `rn-no-inline-object-in-list-item` are intentionally left enabled: they flag allocations created _inside_ the per-row `renderItem` body (closures and object/array literals), which React Compiler does not memoize, so they remain real findings under the compiler.
