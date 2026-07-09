---
"oxlint-plugin-react-doctor": patch
---

Next.js rules gain a file-level platform gate mirroring the React Native one: every `framework: "nextjs"` rule is wrapped with `wrapNextjsRule` / `isNextFileActive` at registry load. The project-level `requires: ["nextjs"]` capability only says SOME workspace depends on Next, so in a monorepo the Next rules (several at error severity) also fired on web-only sibling packages — a Vite playground or plain component library got `next/image` / `next/head` advice for files that never run under Next. The nearest `package.json` is now the authority: a nested workspace package that declares dependencies without `next` skips the Next rules, while manifests declaring `next`, marker-only manifests, the project root, and filename-less test hosts stay active.
