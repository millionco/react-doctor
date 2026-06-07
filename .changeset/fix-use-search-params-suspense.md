---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `nextjs-no-use-search-params-without-suspense` and add cross-file detection. The rule now only fires on page/layout files and additionally resolves relative imports to detect when an imported component calls `useSearchParams()` without being wrapped in `<Suspense>` at the render site.
