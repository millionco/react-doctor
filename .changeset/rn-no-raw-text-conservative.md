---
"oxlint-plugin-react-doctor": patch
---

fix(rn-no-raw-text): stop flagging raw text inside imported custom components

The `rn-no-raw-text` rule reported raw text inside any element it couldn't prove was a text component — including custom components imported from other files (e.g. a `<MyButton>` that wraps its label in `<Text>` internally). Since the single-file pass can't see across imports, this produced false positives on the common "custom component that renders Text" pattern.

The rule now anchors its report on where React Native actually crashes — a host boundary. It reports raw text only inside a known React Native host primitive (`View`, `ScrollView`, `Pressable`, the `Touchable*` family, `Modal`, …), a lowercase intrinsic, or an in-file component proven to forward its children outside a `<Text>`. An imported or otherwise un-analyzable custom component is left alone rather than assumed to crash. In-file detection of text wrappers and proven-unsafe wrappers is unchanged, and projects can still name cross-file wrappers via `rawTextWrapperComponents` / `textComponents`.
