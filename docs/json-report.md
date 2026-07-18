# JSON report

`react-doctor --json` and `react-doctor --json-out <path>` emit the versioned
`JsonReport` wire format. New consumers should branch on `schemaVersion`.

## Version 3

Version 3 is the default. Versions 1 and 2 remain accepted by the exported
`JsonReport` schema for existing reports.

Each diagnostic includes:

- `id`: deterministic
  `<reportRelativeFilePath>::<line>:<column>::<plugin>/<rule>::<occurrenceDigest>`
  identity. The digest covers severity and message so content variants at one
  normalized site receive distinct identities. Treat this as an opaque value:
  it is stable for an unchanged finding, but changes when its user-visible
  content changes.
- `normalizedFilePath`: project-relative path with `/` separators
- canonical `plugin`, `rule`, `category`, `severity`, and sorted `tags`
- the original `filePath` and source span fields

Each project includes:

- `packageRoot` and `framework`
- sorted, deduplicated `analyzedFiles` and `analyzedFileCount`
- `complete`, which is true only when every planned lint file completed and no
  check failed
- `skippedChecks` and optional `skippedCheckReasons`

`mode` remains one of `full`, `diff`, `staged`, or `baseline`. A baseline report
uses `mode: "baseline"` and includes the optional `baseline` block. Consumers
must not infer coverage from an empty `diagnostics` array: use each project's
`complete` and `analyzedFiles` fields.

Baseline comparison identifies a finding by its plugin/rule, diagnostic
message, and normalized diagnosed source range. The identity is independent of
file and line, so unchanged findings remain pre-existing after a rename or
component extraction. Identical findings are compared as a multiset, so an
additional occurrence is still reported as introduced. When a handler moves
behind a component prop, the comparison follows the prop only if every
discovered callsite resolves through the TypeScript syntax tree to one
unambiguous handler. Git supplies separate base and head path sets with rename
detection disabled, so pure renames, deletions, copies, case-only path changes,
and unusual filenames do not depend on heuristic similarity scores. A missing,
binary, or unsmudged Git LFS base blob, unresolved index conflict, missing head
file, or partial lint degrades the run to ordinary diff reporting instead of
assigning unsupported new/fixed results.
