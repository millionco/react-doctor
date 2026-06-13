# @react-doctor/api

## 0.5.2

### Patch Changes

- Updated dependencies [[`2f26228`](https://github.com/millionco/react-doctor/commit/2f26228e36cfe64a430a41596d7b1053d6d7d307), [`a48fb06`](https://github.com/millionco/react-doctor/commit/a48fb06ffbe7221655e18529fcc954ecae17a22f)]:
  - @react-doctor/core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [[`963eaf5`](https://github.com/millionco/react-doctor/commit/963eaf53db7de069baf2c7d18075443c3d934f9b), [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede)]:
  - @react-doctor/core@0.5.0

## 0.4.2

### Patch Changes

- [#721](https://github.com/millionco/react-doctor/pull/721) [`d17dc87`](https://github.com/millionco/react-doctor/commit/d17dc87865e059f21534990d0925115db439dc3e) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a `defineConfig` helper for authoring a typed `doctor.config.{ts,js,mjs,cjs}` and read `react-doctor.config.json` as a deprecated fallback.

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

- Updated dependencies [[`d17dc87`](https://github.com/millionco/react-doctor/commit/d17dc87865e059f21534990d0925115db439dc3e)]:
  - @react-doctor/core@0.4.2

## 0.2.21

### Patch Changes

- Updated dependencies [[`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b)]:
  - @react-doctor/core@0.3.1

## 0.2.20

### Patch Changes

- Updated dependencies [[`9a8ad6e`](https://github.com/millionco/react-doctor/commit/9a8ad6e40d9ed1fbe7ddb1f1c57bfd5c791a4b9e)]:
  - @react-doctor/core@0.3.0

## 0.2.19

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.2.19

## 0.2.18

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.2.18

## 0.2.17

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.2.17

## 0.2.16

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.2.16

## 0.2.15

### Patch Changes

- Updated dependencies [[`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7), [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7)]:
  - @react-doctor/core@0.2.15

## 0.2.14

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.2.13

## 0.2.12

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies []:
  - @react-doctor/core@0.2.11

## 0.2.10

### Patch Changes

- Inherit core scan fixes for Preact project detection, React 19.2 capability gating, and dead-code analysis reliability, so programmatic `diagnose()` callers get the same behavior as the CLI.

- Dependency bump: `@react-doctor/core@0.2.10`.

## 0.2.9

### Patch Changes

- Dependency bump: `@react-doctor/core@0.2.9`.

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
