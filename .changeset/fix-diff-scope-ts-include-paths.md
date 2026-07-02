---
"react-doctor": patch
---

Diff scopes no longer skip changed `.ts`/`.js` files that contain React code. `--scope files`, `--scope changed`, `--scope lines`, and `--staged` filtered explicit include paths to `.tsx`/`.jsx` only, so a changed `.ts` hook that a full scan flags was reported clean (0 diagnostics). Changed non-JSX source files are now included when their content references React (a react/preact import or a hook call). Non-React `.ts`/`.js` changes stay excluded, so diff scopes remain quiet on server and utility code.
