---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `nextjs-no-use-search-params-without-suspense`: the rule now only fires on page/layout files where the developer is responsible for providing their own `<Suspense>` boundary. Non-page component files are no longer flagged since they are expected to be wrapped in Suspense by their consumers.
