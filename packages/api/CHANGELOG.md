# @react-doctor/api

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

- Updated dependencies []:
  - @react-doctor/core@0.2.8

## 0.2.7

### Patch Changes

- Use core's exported `layerInspectLive` instead of reimplementing the layer stack, ensuring the API entry point stays in sync with CLI behavior.

- Inherit concurrent lint + dead-code analysis and diagnostic pipeline unification from `@react-doctor/core@0.2.7`.

- Updated dependencies []:
  - @react-doctor/core@0.2.7

## 0.2.6

### Patch Changes

- Inherit the `design-no-bold-heading` rule removal from `@react-doctor/core@0.2.6`.

- Updated dependencies []:
  - @react-doctor/core@0.2.6

## 0.2.5

### Patch Changes

- Inherit the `require-pnpm-hardening` check, child workspace diff path coverage, and Node 20 support from `@react-doctor/core@0.2.5`.

- Updated dependencies []:
  - @react-doctor/core@0.2.5

## 0.2.4

### Patch Changes

- **New package.** Programmatic `diagnose()` entry point backed by the core `runInspect` streaming orchestrator. Provides typed `ReactDoctorError` failures with `Effect.catchReasons` dispatch for fine-grained error recovery. Replaces the previous `diagnose()` that lived inside `react-doctor` with a standalone package that embedders (Vercel AI Code Review, CI pipelines) can depend on without pulling in the CLI.

- Updated dependencies []:
  - @react-doctor/core@0.2.4
