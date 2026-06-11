---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix false positives in `rn-no-raw-text` (#788) for custom components that forward their children into a `<Text>`: the in-file wrapper detection now recognizes components that render `{children}` (or `{props.children}`) inside a nested `<Text>` (the `<View><Text>{children}</Text></View>` shape), not just components whose returned root is a `<Text>`, and unwraps parenthesized `return (...)` bodies. The rule is also tagged `test-noise`, so it no longer fires in test/story files — raw text rendered through React Native Testing Library never ships to users, and cross-file wrappers (an imported `<Chip>Test Chip</Chip>` in a `.test.tsx`) were the main source of unfixable noise there.
