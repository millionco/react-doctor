---
"oxlint-plugin-react-doctor": patch
---

Fix false positives in `nextjs-no-use-search-params-without-suspense` and add cross-file detection. The rule now only fires on page/layout files and resolves imported components — via relative paths, tsconfig `@/` aliases, and barrel re-exports — to detect when a rendered component calls `useSearchParams()` without a `<Suspense>` boundary at the render site. A `<Suspense>` provided by an ancestor `layout.tsx`, the `<React.Suspense>` member form, and aliased `Suspense` imports are all recognized so correctly-wrapped pages aren't flagged.
