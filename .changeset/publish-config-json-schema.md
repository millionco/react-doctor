---
"react-doctor": patch
---

Publish a JSON Schema for `react-doctor.config.json` at `https://react.doctor/schema/config.json`.

Pointing `$schema` at the URL enables editor autocomplete, hover docs from the interface JSDoc, and typo warnings in any editor that understands JSON Schema. Closes #497.

```jsonc
{
  "$schema": "https://react.doctor/schema/config.json",
  "lint": true,
}
```

The schema is generated from `packages/core/src/types/config.ts` via `pnpm build:schema` and checked into `packages/website/public/schema/config.json`.
