---
"react-doctor": patch
---

`rn-no-raw-text` no longer false-positives on Expo Universal UI (`@expo/ui`) `ListItem`.

Universal UI's `<ListItem>` renders its raw string children inside the native headline text area, and its compound slot markers (`<ListItem.Leading>`, `<ListItem.Supporting>`, `<ListItem.Trailing>`) forward strings into native text too — so raw text inside them is safe, unlike React Native's core `<View>`. The rule now recognizes these as text-handling. Detection is gated on the `@expo/ui` import (root, `@expo/ui/swift-ui`, or `@expo/ui/jetpack-compose`, including renamed and namespace imports), so a same-named custom `ListItem` in a plain React Native app still reports.
