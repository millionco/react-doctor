---
"react-doctor": patch
---

Fix nested workspace project config resolution (#1772)

Nested workspace projects with their own configs (framework, React Compiler, etc.) are now correctly excluded from parent scans, regardless of whether they're selected. Previously, when scanning only the root project, files from nested workspace projects were incorrectly scanned with the parent's config, causing false positives when configs differed.

For example, a React Native app with React Compiler enabled inside a Vite monorepo would trigger `prefer-module-scope-pure-function` warnings when scanning only the root, even though the rule should be suppressed by the nested project's React Compiler setting.
