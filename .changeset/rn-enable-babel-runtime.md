---
"react-doctor": patch
---

Add `rn-no-metro-babel-runtime-version` — warns when a babel config uses `module:@react-native/babel-preset` without an `enableBabelRuntime` version. Without a version the preset can duplicate Babel runtime helpers across files instead of importing them once from `@babel/runtime`, increasing the JS bundle (facebook/react-native#57123). It fires as a `warning` (a bundle-size optimization, not a broken build, so it never blocks CI on the default React Native config), only when the preset is referenced as a real string literal (Expo's `babel-preset-expo` and comment mentions are unaffected), and treats `enableBabelRuntime: true`/`false` as still missing a version.
