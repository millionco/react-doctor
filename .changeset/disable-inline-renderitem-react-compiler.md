---
"oxlint-plugin-react-doctor": patch
---

Stop flagging the inline-`renderItem` React Native perf rules on React Compiler projects.

React Compiler auto-memoizes inline functions and objects in list rows, so these rules were noise on compiler-enabled projects (#723). `rn-no-inline-flatlist-renderitem`, `rn-list-callback-per-row`, and `rn-no-inline-object-in-list-item` now ship with `disabledBy: ["react-compiler"]`, matching the `jsx-no-new-*-as-prop` family.
