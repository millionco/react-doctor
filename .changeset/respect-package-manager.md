---
"react-doctor": patch
---

Respect project package manager and installed version in GitHub Action. The action now detects the project's package manager (pnpm/yarn/bun/npm) and uses it instead of hardcoded npm commands. When react-doctor is installed in dependencies/devDependencies, the action uses the installed version instead of downloading a new one, enabling version pinning. Fixes compatibility with projects that enforce strict package manager usage via `packageManager` field.
