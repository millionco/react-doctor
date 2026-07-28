# Internal architecture rewrite

- Status: implemented and validated
- Started: 2026-07-27
- Goal: simplify React Doctor's internals without changing observable behavior

This document records durable design decisions. Git history and the pull request retain the
implementation diary.

## Goals

The rewrite makes it clear:

- which package owns each responsibility;
- which direction dependencies may flow;
- where behavior is tested;
- which implementation details can change without affecting consumers;
- how replacements prove exact compatibility before old code is removed.

This was an internal migration, not a product redesign. Existing package APIs, commands, flags,
diagnostics, reports, scores, terminal behavior, and production lint backend remain intact.

## Reference codebases

The design study used:

- [aidenybai/react-grab](https://github.com/aidenybai/react-grab) at
  `2a39bc29e5f8bdbd69095cf1d33d91634576cd20`;
- [aidenybai/bippy](https://github.com/aidenybai/bippy) at
  `051a9b28f0a23da29b2e6e94a6e1ddae687b8926`;
- this repository's `AGENTS.md` and its owned references.

These are sources of design judgment, not templates.

### Lessons retained from React Grab

**Deliberate public surfaces.** React Grab exposes small capability-oriented entry points rather
than mirroring its source tree. React Doctor follows the same principle: published exports describe
supported jobs, while implementations remain private and movable.

**One-purpose utilities.** Stateless, domain-neutral helpers use descriptive kebab-case filenames
and stay focused. Domain behavior remains with its owner instead of collecting in a global utility
bucket.

**Transactional state and cleanup.** Replacement state is prepared before it becomes active, and
partial setup is rolled back. React Doctor applies this to scan planning, caches, temporary files,
subprocesses, telemetry scopes, and progress reporting.

**Facade and mechanism tests.** Published behavior, private mechanisms, failure paths, ordering,
cleanup, and legacy behavior are tested at their appropriate boundaries.

**Performance-aware design.** AST traversal, path resolution, batching, cache fingerprints, and
process startup are measured rather than assumed to be cheap.

**Explicit build targets.** Package entry points, runtime environments, declarations, bins, and
packed contents are tested as product behavior.

React Grab's large orchestration and type files were not copied. Its useful patterns are the
facades, lifecycle ownership, testing boundaries, and explicit packaging.

### Lessons retained from Bippy

**A small conceptual center.** Bippy has one clear job and organizes optional capabilities around
it. React Doctor keeps scanning and diagnostics at the center while CLI, API, LSP, evaluation, and
editor behavior stay in adapters.

**Visible side-effect ordering.** Process-global initialization belongs at composition roots.
Sentry, console mutation, environment capture, cache initialization, and CLI instrumentation do
not leak into library entry points.

**Shared parity suites.** Bippy runs equivalent renderer behavior through several adapters. React
Doctor uses the same idea for real and virtual resources, evaluator and Oxlint execution, CLI
modes, package surfaces, and cached versus cold scans.

**Composable cleanup.** Unsupported and disabled environments use no-op implementations, while
acquired resources have explicit scoped cleanup.

**Packaging and adversarial integration tests.** Missing bindings, malformed configuration,
worktrees, symlinks, timeouts, partial failures, repeated state, and installed tarballs receive
direct coverage.

Bippy's intentionally centralized React-internals code was not copied. React Doctor's domains are
more separable.

## Compatibility guarantees

[Compatibility guarantees and snapshots](compatibility.md) owns the update process and repository
paths.

The rewrite preserves:

- package names, bins, subpath exports, module formats, declarations, and packed files;
- exported names, signatures, runtime identities, and error behavior;
- CLI commands, aliases, flags, defaults, validation, streams, prompts, and exit codes;
- JSON report schemas 1, 2, and 3;
- diagnostic identity, ordering, locations, severity, suppression, and scoring;
- configuration filenames, schema, precedence, and path resolution;
- LSP diagnostics, data, hovers, actions, and commands;
- GitHub Action inputs, outputs, environment behavior, comments, and failures;
- telemetry names, attribute types, privacy filtering, and disabled no-op behavior;
- supported Node, package-manager, Windows, macOS, Linux, and terminal behavior.

Only nondeterministic values already outside the product guarantee may be normalized, such as
elapsed time, generated temporary roots, and Oxlint's generated `start_time`. Every other old/new
difference must be eliminated or recorded in the reviewed delta ledger.

## Package ownership

| Package                                        | Owner                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/core`                                | Diagnostic engine, project discovery, scan policy, services, runners, post-processing, and scoring |
| `packages/api`                                 | Programmatic `diagnose()` shell                                                                    |
| `packages/react-doctor`                        | Published CLI, public `inspect()`, rendering, and runtime composition                              |
| `packages/oxlint-plugin-react-doctor`          | Canonical rule engine and rule implementation                                                      |
| `packages/eslint-plugin-react-doctor`          | ESLint mirror                                                                                      |
| `packages/language-server`                     | Editor protocol adapter                                                                            |
| `packages/evals`                               | Repository evaluation harness                                                                      |
| `packages/fuzz`                                | Adversarial rule fuzzing                                                                           |
| `packages/deslop-js` and `packages/deslop-cli` | Dead-code and redundancy products                                                                  |
| editor packages                                | Thin editor-specific adapters                                                                      |

## Dependency direction

```text
published adapters
  CLI / API / LSP / ESLint
          |
          v
application workflows
  resolve request -> plan -> execute -> assemble
          |
          v
domain capabilities
  diagnostics / projects / config / scoring / suppression
          |
          v
service interfaces
  files / git / linter / dead code / supply chain / reporting
          |
          v
infrastructure
  filesystem / subprocesses / Oxlint / HTTP / persistent caches
```

Rules:

1. Foundation types, schemas, and errors do not import services, runners, orchestration, telemetry,
   or CLI code.
2. Project discovery remains below runtime services and orchestration.
3. Domain-neutral leaf utilities do not depend on runtime layers.
4. Infrastructure implements service interfaces and owns third-party details.
5. Workflows coordinate through services.
6. API, CLI, and LSP adapters select layers and translate results.
7. Rendering and telemetry consume completed events and results; they do not own scan policy.
8. Compatibility facades may point inward; new internals never point back to a broad facade.

The architecture checker parses production imports and enforces these directions.

## Implemented architecture

### Scan workflow

The former Core orchestrator was split into owned stages:

- resolve scan settings;
- build lint and dead-code execution plans;
- run lint, dead-code, supply-chain, and project checks;
- coordinate background analyzers;
- finalize diagnostic output;
- assemble score metadata and the final result.

The old facade remains where callers need it, but policy and lifecycle code now have focused owners.

### Project model

A normalized package graph collects workspace packages, package boundaries, dependency
declarations, versions, workspace/catalog resolution, and package-local capabilities once.

Legacy `ProjectInfo` fields remain as a compatibility projection. Rules and scans can query the
package that owns the current file without repeating nearest-`package.json` walks or collapsing a
monorepo into one dependency answer.

### Git and project services

Git command execution, output parsing, revision policy, diff selection, and the Effect service are
separate modules. Project checks have an explicit service boundary. Errors remain typed
`ReactDoctorError` values with existing external behavior.

### React Doctor adapter

The published package consumes Core through cohesive private adapters for configuration,
diagnostics, errors, presentation, product metadata, project discovery, reporting, runtime
composition, scan caching, scoring, types, and version control.

An AST boundary test prevents broad Core imports from leaking back into CLI, Ink, telemetry,
cache, or public-facade code.

Option resolution, project scan planning, baseline comparison, rendering, cache policy, cache
lifecycle, and result construction now have explicit owners.

### Rule evaluation

The production-owned private evaluator reuses the parser, visitor, scope, control-flow graph, rule
registry, source locations, and suppression infrastructure.

It accepts single-source and virtual-project inputs through one resource-host boundary. Real and
in-memory hosts use the same normalized resource semantics. Unsupported rules fail explicitly
instead of silently returning incomplete diagnostics.

The evaluator remains private because its supported-rule matrix, Flow policy, fixes, secondary
labels, open-source evidence, and resource budgets are not yet broad enough for a stable public
API.

### Backend boundary

The `Linter` service owns backend selection. Production still uses fresh Oxlint subprocesses with
the existing OOM splitting and serial fallback.

### Backend-neutral diagnostic processing

Suppression, severity overrides, deduplication, ordering, score filtering, and result assembly are
owned outside a specific linter backend. Shared tests freeze their exact behavior.

### Build and repository policy

The repository now enforces:

- source dependency directions;
- public package manifests and exports;
- installed tarball entry points and runtime dependencies;
- CLI help surfaces;
- JSON report smoke behavior;
- published dependency policy;
- generated rule-registry freshness;
- synchronized skills and valid agent references.

Compatibility evidence and its tooling live together under `scripts/compatibility/`.

## Validated proposal decisions

| Proposal                                    | Decision                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Public in-process rule runner               | Keep private until the supported-rule matrix and product semantics are complete |
| Virtual-project evaluation                  | Implemented privately through the resource host                                 |
| Normalized package graph                    | Implemented as the source of workspace and dependency truth                     |
| Capabilities derived from package graph     | Implemented while preserving legacy `ProjectInfo` fields                        |
| Package-aware rule context                  | Implemented with legacy activation unchanged by default                         |
| In-process production backend               | Rejected for now; the host surface and parity corpus are incomplete             |
| Oxlint/in-process parity suite              | Implemented for the supported evaluator corpus                                  |
| Explicit `--workers` CLI option             | Deferred as a public product decision                                           |
| Global scan worker budgeting                | Implemented internally across concurrent project scans                          |
| Backend-neutral post-processing             | Implemented and protected by shared behavior tests                              |
| Separate `diagnose()` and `evaluate()` APIs | `diagnose()` remains public; `evaluate()` remains private                       |

## Exact-compatibility proof

Each migration slice was checked at several boundaries:

1. **Source surface:** exports, signatures, identities, errors, rule IDs, configuration, CLI input,
   and schema versions.
2. **Built product:** real workspace tarballs installed into an empty project, with every supported
   entry imported and the installed CLI executed.
3. **Behavior:** diagnostics, ordering, locations, severity, suppression, score input, output
   streams, exit status, errors, cache replay, and editor protocol data.
4. **Differential execution:** real resources, in-memory resources, the private evaluator, and
   built Oxlint compared through common fixtures where supported.
5. **Resilience:** OOM splitting, serial fallback, deadlines, partial failures, aborts, output
   limits, repeated state, and cleanup.
6. **Architecture:** parsed import boundaries, adapter bypass checks, generated outputs, and skill
   integrity.

The normal approved-delta ledger is empty.

## Required validation

Run the repository gates from `AGENTS.md`:

```bash
nr test
nr lint
nr typecheck
nr format:check
nr smoke:json-report
nr architecture:check
nr test:architecture
nr compatibility:check
nr test:compatibility
nr test:build-policy
nr skills:check
nr build
nr check:published-deps
nr smoke:packed-cli-install
```

CI additionally covers supported Node versions, Windows, macOS, Linux, CodeQL, terminal recording,
and the React Doctor self-scan.

## Deferred work

- Expand virtual-project support and differential evidence across the remaining cross-file rule
  families.
- Add fixes, secondary labels, Flow policy, budgets, and open-source-hit review before considering
  a public `evaluate()` API.
- Revisit an in-process backend only after effectively complete parity over a representative
  corpus.
- Treat `--workers` as a separately reviewed CLI decision.
- Keep legacy `ProjectInfo` compatibility fields until a separately authorized breaking release.
- Add a downstream TypeScript consumer fixture to the installed-tarball checks.

These are future product or backend decisions, not unfinished structural cleanup.
