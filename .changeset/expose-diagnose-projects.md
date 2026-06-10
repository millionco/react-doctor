---
"react-doctor": minor
---

Expose `diagnoseProjects()` from the published `react-doctor` package for native per-module scoring — scan many projects in parallel and get per-project scores, diagnostics, and a worst-of aggregate score without shelling out to the CLI per module.

Per-project `config` now **merges additively** onto the base config instead of replacing it: `rules` / `categories` merge per key, `ignore` lists union, and scalar fields override. A new batch-level `config` on `diagnoseProjects({ config })` applies one shared base rule set across every project, with each project's own `config` layered on top.

```ts
import { diagnoseProjects } from "react-doctor";

const result = await diagnoseProjects({
  projects: [
    { directory: "packages/app" },
    { directory: "packages/shared", deadCode: false },
    { directory: "packages/admin", config: {
      rules: { "react-doctor/no-array-index-as-key": "off" },
    }},
  ],
  config: { rules: { "react-doctor/no-prop-drilling": "off" } },
  concurrency: 4,
});
```
