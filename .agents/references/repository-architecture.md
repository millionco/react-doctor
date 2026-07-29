# Repository architecture

Use this reference when choosing package ownership or an import direction. Root [AGENTS.md](../../AGENTS.md) makes this layout binding.

## Package ownership

- `packages/core`: private diagnostic engine, project discovery, scan policy, services, backend runners, diagnostic processing, and scoring
- `packages/api`: private programmatic `diagnose()` shell around the core engine
- `packages/react-doctor`: published CLI, public `inspect()`, terminal rendering, and runtime adapters
- `packages/oxlint-plugin-react-doctor`: published rule engine and canonical rule implementation
- `packages/eslint-plugin-react-doctor`: published ESLint mirror
- `packages/deslop-js`: published dead-code and redundancy analysis library
- `packages/deslop-cli`: published CLI for `deslop-js`
- `packages/evals`: private Daytona evaluation harness
- `packages/fuzz`: private adversarial rule fuzzing harness
- `packages/language-server`: private editor language server bundled into the CLI
- `packages/vscode-react-doctor`: private Visual Studio Code extension
- `packages/zed-react-doctor`: unpublished Zed extension

## Core layers

Keep dependencies pointing down this list:

1. Foundation types in `packages/core/src/types/`, `packages/core/src/schemas.ts`, and `packages/core/src/errors.ts`
2. Project discovery and the normalized package graph in `packages/core/src/project-info/`
3. Domain logic and leaf utilities
4. Service interfaces and implementations in `packages/core/src/services/`
5. Backend implementations in `packages/core/src/runners/`
6. Scan orchestration in `packages/core/src/run-inspect.ts`
7. API, CLI, language-server, and editor adapters

Foundation types, schemas, and errors must not import services, runners, orchestration, telemetry, or CLI code. Project discovery must remain below runtime services and orchestration. Leaf utilities must not depend on those runtime layers.

The package graph owns workspace package boundaries, dependency declarations, catalog and workspace resolution, and package-local capability queries. Keep legacy `ProjectInfo` as a compatibility projection rather than a second discovery model.

The `Linter` service owns the backend boundary. Keep Oxlint process management behind its layer so orchestration and post-processing do not depend on a specific backend.

## Import boundaries

`@react-doctor/core` remains a compatibility facade. New code inside `packages/react-doctor` must import cohesive capabilities through `packages/react-doctor/src/core/` adapters. Only those adapters may import the broad core entry point.

Prefer direct, owned modules inside a package. Do not add a barrel that exposes unrelated internals or hides a backward dependency.

The oxlint plugin owns rule code and its canonical dependency-name data. Core must not import the rule package at runtime or re-export rule internals.
