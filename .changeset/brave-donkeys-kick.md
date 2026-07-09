---
"react-doctor": minor
"@react-doctor/core": minor
---

feat: expose rule tags in JSON + add declarative tag filtering (partial implementation)

**What's included:**

1. **Schema changes (schemaVersion 3)**
   - Added `tags` array field to `Diagnostic` interface and Schema
   - Added optional `blocking` boolean field to diagnostics
   - Bumped JSON report to schemaVersion 3 (JsonReportV3)
   
2. **Tag metadata flowing**
   - Tags from rule definitions now flow through diagnostic pipeline
   - Added `getRuleTags()` helper in parse-output.ts
   - All diagnostics include tags when present

3. **CLI flags**
   - Added `--exclude-tag <tag>` flag (repeatable)
   - Added `--include-tag <tag>` flag (repeatable)
   - Tags are parsed and wired through inspect options

4. **Filtering utilities**
   - Created `filterDiagnosticsByTags()` utility function
   - Include tags take precedence over exclude tags

**What's NOT yet complete:**

This is a partial implementation. Full feature delivery requires:
- Wiring tag filters through inspect.ts rendering
- Adding `rules list --json` command for machine-readable catalog
- Stamping `blocking` field on diagnostics based on active filters
- Config support for gate filtering (gate.excludeTags, gate.includeTags)
- Comprehensive tests
- Telemetry wiring
- RDE parity validation

The schema changes are backward-compatible additive changes that prepare the foundation for the full tag filtering feature.
