---
"oxlint-plugin-react-doctor": patch
---

fix(rn-no-raw-text): report raw text by where it actually crashes, resolving imported wrappers across files

The `rn-no-raw-text` rule reported raw text inside any element it couldn't prove was a text component — including a custom component imported from another file (e.g. a `<MyButton>` that wraps its label in `<Text>` internally), which produced false positives on the common "custom component that renders Text" pattern.

The rule now anchors its report on where React Native actually crashes — a host boundary — and resolves imported components across files instead of guessing:

- Raw text is reported inside a known host primitive (`View`, `ScrollView`, `Pressable`, the `Touchable*` family, `Modal`, …), a lowercase intrinsic, or an in-file component proven to forward its children into one.
- A component imported from another first-party file (relative or tsconfig-alias) is resolved and classified the same way: one that wraps its children in `<Text>` is left alone, while one that renders them into a `<View>` is still reported — so genuine crashes inside imported wrappers are kept.
- Components the resolver can't follow (`node_modules`, namespace imports, unanalyzable exports) are left unreported rather than assumed to crash; `rawTextWrapperComponents` / `textComponents` config still covers those.
- React's structural `<Fragment>` / `<React.Fragment>` now counts as a transparent wrapper alongside fbtee's `<fbt>` / `<fbs>`, so an `<fbt>` nested under a `<Fragment>` inside a `<Text>` is no longer falsely flagged.
