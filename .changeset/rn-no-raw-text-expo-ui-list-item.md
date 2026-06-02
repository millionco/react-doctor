---
"react-doctor": patch
---

Two React Native rules no longer false-positive on Expo Universal UI (`@expo/ui`).

`@expo/ui` is a native UI layer (it delegates to SwiftUI / Jetpack Compose), not React Native's core primitives, so several RN-core assumptions don't hold for its components:

- **`rn-no-raw-text`**: Universal UI's `<ListItem>` renders its raw string children inside the native headline text area, and its compound slot markers (`<ListItem.Leading>`, `<ListItem.Supporting>`, `<ListItem.Trailing>`) forward strings into native text too — so raw text inside them is safe, unlike React Native's core `<View>`. The rule now recognizes them as text-handling.
- **`rn-no-scrollview-mapped-list`**: Universal UI's `<ScrollView>` is a native scroll container; React Native's virtualized lists (`FlashList`/`FlatList`) can't compose inside its `<Host>` tree, and `@expo/ui` ships its own virtualized `<List>`. The rule no longer flags mapped children inside an `@expo/ui` `ScrollView`.

Both checks are gated on the `@expo/ui` import (root, `@expo/ui/swift-ui`, or `@expo/ui/jetpack-compose`, including renamed and namespace imports), so same-named components from other libraries — or with no import — still report.
