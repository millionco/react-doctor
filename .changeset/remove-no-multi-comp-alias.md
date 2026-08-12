---
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
---

fix: remove react/no-multi-comp alias to enable strict oxlint version

Removes the alias from `react/no-multi-comp` to `react-doctor/no-multi-comp`. This change allows users who want strict "one component per file" enforcement to access oxlint's `react/no-multi-comp` rule via `.oxlintrc.json`, while preserving the lenient `react-doctor/no-multi-comp` behavior for users who explicitly configure it.

The react-doctor version is intentionally more permissive, with corpus-informed exemptions for:
- Files with ≤2 components (main + helper)  
- Feature modules (1-2 exports + private helpers)
- Barrel files (mostly-exported components)

Users who previously configured `react/no-multi-comp` and want to continue using the lenient version should update their config to use `react-doctor/no-multi-comp` explicitly. Users who want the strict oxlint behavior can create an `.oxlintrc.json` file:

```json
{
  "plugins": ["react"],
  "rules": {"react/no-multi-comp": "error"}
}
```

Closes #1639
