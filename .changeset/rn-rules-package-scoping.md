---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"@react-doctor/core": patch
"@react-doctor/project-info": patch
"@react-doctor/types": patch
"react-doctor": patch
---

Scope React Native rules to per-package boundaries. Previously every
`rn-*` rule fired on every file in a project whose top-level framework
was detected as React Native or Expo — even on sibling workspaces that
were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
alongside `apps/web` and `packages/storybook`) the rules would noisily
report issues against Next.js, Vite, Docusaurus, Storybook, and plain
React DOM packages where they don't apply.

React Native rules now walk up to the file's nearest `package.json`
before running. The rule body is skipped when the package declares a
web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
`@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
`react-dom` without an RN sibling) and stays active when the package
declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
`react-native-macos`, anything under the `@react-native/` or
`@react-native-` community namespaces (`@react-native-firebase/*`,
`@react-native-async-storage/*`, `@react-native-community/*`, …), or
Metro's top-level `"react-native"` resolution field.

The detection is bidirectional: a web-rooted monorepo (root
`package.json` declares `next` or `vite`) still loads `rn-*` rules
when any workspace targets React Native or Expo, so the rules now
fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
layout that the file-level boundary alone covered.

`rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
`Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
Optional chaining (`Platform?.OS`) and the TS non-null assertion
(`Platform.OS!`) parse the same way as the bare form. The walker stops
at function and `Program` boundaries so JSX defined inside a callback
hoisted out of a `Platform.OS` branch does not inherit the parent
guard.

Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
keep the rule active even when the surrounding package classification
is ambiguous.
