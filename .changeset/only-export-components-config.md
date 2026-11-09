---
"react-doctor": minor
---

Add an `onlyExportComponents` config option that forwards `customHOCs`, `allowExportNames`, `allowConstantExport`, and `checkJS` to the `only-export-components` rule, so exports wrapped in project HOCs (for example `export const Screen = withErrorBoundary(ScreenContent)`) stop being reported.
