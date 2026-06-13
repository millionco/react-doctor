---
"react-doctor": patch
---

Add `rn-no-metro-babel-runtime-version` — flags a babel config using `module:@react-native/babel-preset` without the `enableBabelRuntime` option. Without it the preset inlines Babel helpers into every file instead of importing them once from `@babel/runtime`, duplicating code and bloating the JS bundle (facebook/react-native#57123). Expo's `babel-preset-expo` is unaffected, so only configs referencing the React Native preset are checked.
