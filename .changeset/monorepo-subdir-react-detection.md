---
"@react-doctor/core": patch
---

Detect React when scanning a package subdirectory of a monorepo, so React rules no longer gate off silently. Two additions at the `discoverProject` seam:

- **Nearest-ancestor discovery.** A scan target with no `package.json` of its own now adopts the nearest enclosing package (a leaf workspace, a plain app root, or a monorepo root — whichever is closest, bounded by the git root) instead of only workspace-configured monorepo roots. Scanning `app/src/components` in a plain React app now inherits the app's React detection rather than synthesizing an empty, React-blind project.
- **Node-resolution React version fallback.** When declarations yield no usable React version (a version-less spec like `workspace:*` / `*` / a dist-tag, or React living only in a hoisted `node_modules` the declaration walks never reach), the version is resolved the way Node itself would — `require.resolve("react/package.json")` — making "React is installed and importable" ⇒ "React is detected" an invariant. Guarded to installations physically inside the enclosing repo so a globally installed React can't leak in, and it never overrides a parseable peer range (`^18 || ^19` still floors to the lowest supported major).
