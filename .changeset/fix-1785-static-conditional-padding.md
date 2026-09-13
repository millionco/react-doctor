---
"oxlint-plugin-react-doctor": patch
---

Fix an `rn-scrollview-dynamic-padding` false positive on `contentContainerStyle` padding that picks between two static values (`hasHeader ? 0 : 16`), and scope the recommendation to iOS `contentInset`.
