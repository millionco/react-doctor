---
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Reduce scan startup time and workspace contention by loading lightweight rule
metadata, sharing Oxlint subprocess capacity across projects, and reusing
semantic and filesystem analysis within each scan. Keep cached diagnostics
correct when imported browser guards, Next.js manifests, nested project
targets, or TypeScript path configuration change, and ignore explicitly
disabled inline CSS animations and transitions in Remotion rules.
