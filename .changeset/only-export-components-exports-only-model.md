---
"oxlint-plugin-react-doctor": patch
---

`only-export-components` is re-derived against the actual react-refresh boundary constraint, which is about exports only: a module that exports a component must export only components / allowed constants. Non-exported internal components are no longer reported (react-refresh registers them fine, and "export this component" was the wrong advice for config/registry files that merely use a local component). The previously-missed real breaker is now detected: a namespace-object export that bundles components (`export const Pages = { Home, sidebarWidth: 240 }` / `export default { Home, helpers }`) fails the boundary check for the whole module and is reported.
