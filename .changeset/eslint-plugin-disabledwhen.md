---
"eslint-plugin-react-doctor": patch
---

ESLint plugin now respects `disabledWhen` capabilities. Rules like `jsx-no-new-function-as-prop` that have `disabledWhen: ['react-compiler']` will no longer fire when React Compiler is configured in ESLint settings.

Users can enable this by adding to their ESLint config:

```js
export default {
  settings: {
    'react-doctor': {
      capabilities: ['react-compiler']
    }
  }
}
```

This matches the CLI behavior where these rules are automatically disabled when React Compiler is detected in `next.config.ts`/`vite.config.ts`.
