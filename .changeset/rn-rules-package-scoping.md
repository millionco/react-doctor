---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Scope React Native rules to per-package boundaries. Previously every
`rn-*` rule fired on every file in a project whose top-level framework
was detected as React Native or Expo — even on sibling workspaces that
were clearly web targets. In a mixed RN + web monorepo (e.g. `apps/mobile`
+ `apps/web` + `packages/storybook`) the rules would noisily report
issues against Next.js, Vite, Docusaurus, Storybook, and plain React DOM
packages where they don't apply.

React Native rules now walk up to the file's nearest `package.json`
before running. The rule body is skipped when the package declares a
web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
`@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
`react-dom` without an RN sibling) and stays active when the package
declares `react-native` or `expo`.

`rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
branches (`if`, `?:`, and `&&` / `||` short-circuits, plus the mirror
`Platform.OS !== "web"` else branches). Native-only file extensions
(`.ios.tsx`, `.android.tsx`, `.native.tsx`) keep the rule active even
when the surrounding package classification is ambiguous.
