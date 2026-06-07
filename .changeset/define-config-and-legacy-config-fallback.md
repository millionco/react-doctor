---
"@react-doctor/core": patch
"@react-doctor/api": patch
"react-doctor": patch
---

Add a `defineConfig` helper for authoring a typed `doctor.config.{ts,js,mjs,cjs}` and read `react-doctor.config.json` as a deprecated fallback.

`defineConfig` is exported from `react-doctor/api` (and `@react-doctor/api` / `@react-doctor/core`) as an identity helper that gives editor autocomplete and type-checking without an explicit `satisfies ReactDoctorConfig` annotation:

```ts
// doctor.config.ts
import { defineConfig } from "react-doctor/api";

export default defineConfig({
  lint: true,
  rules: { "react-doctor/no-array-index-as-key": "off" },
});
```

The pre-migration `react-doctor.config.json` filename is now read as the lowest-priority fallback (after `doctor.config.*` and `package.json#reactDoctor`) instead of being ignored, so an un-migrated config keeps applying. It still emits a deprecation warning nudging a rename, and interactive runs continue to auto-migrate it to `doctor.config.ts`. A present-but-broken legacy file stops config resolution (it won't silently inherit an ancestor repo's config), and `react-doctor rules <...>` migrates a legacy file to `doctor.config.json` on write rather than editing it in place.

Note: a `react-doctor.config.json` that was previously ignored in non-interactive runs (CI, coding agents, `--json`/`--score`/`--staged`) is now honored again, which can change which rules fire, the score, and PR gating for projects that still have one. Rename it to `doctor.config.json` (or delete it) to avoid surprises.
