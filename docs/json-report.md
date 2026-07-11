# JSON report

`react-doctor --json` and `react-doctor --json-out <path>` emit the versioned
`JsonReport` wire format. New consumers should branch on `schemaVersion`.

## Version 3

Version 3 is the default. Versions 1 and 2 remain accepted by the exported
`JsonReport` schema for existing reports.

Each diagnostic includes:

- `id`: deterministic
  `<reportRelativeFilePath>::<line>:<column>::<plugin>/<rule>` identity, unique
  across workspace projects
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
