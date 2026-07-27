# React Doctor rewrite notes

- Status: migration implemented and validated; deferred product/backend decisions recorded
- Started: 2026-07-27
- Goal: substantially simplify React Doctor's internals without changing observable behavior

## Intent

This is a compatibility-preserving rewrite, not a product redesign.

The rewrite should make it obvious:

- which package owns each responsibility;
- which modules are contracts, orchestration, domain logic, or infrastructure;
- which direction dependencies are allowed to flow;
- where a behavior is tested;
- which code can be replaced without affecting consumers.

The migration is complete only when the old implementation can be deleted. A new implementation living beside an equally large legacy implementation is not success.

## Reference codebases

The references were cloned and studied at these snapshots:

- [aidenybai/react-grab](https://github.com/aidenybai/react-grab) at `2a39bc29e5f8bdbd69095cf1d33d91634576cd20`
- [aidenybai/bippy](https://github.com/aidenybai/bippy) at `051a9b28f0a23da29b2e6e94a6e1ddae687b8926`
- this repository's `AGENTS.md`, including its package layout, Effect conventions, testing requirements, product-thinking gate, and release rules

These repositories are references for design judgment, not templates to copy mechanically.

## What is good in React Grab

### Deliberate consumer-facing surfaces

`react-grab` exposes a small default entry point plus intentional `core` and `primitives` subpaths. The public `primitives` module is a facade over private implementation modules, so consumers get a coherent capability-oriented API without inheriting the source tree.

Apply this to React Doctor:

- package exports describe supported use cases, not every reusable-looking internal;
- entry points explicitly re-export chosen symbols;
- old entry points remain compatibility facades while implementations move;
- internal module placement is free to change without creating a consumer migration.

### One-purpose utilities

The `utils` directory generally uses descriptive kebab-case names and one focused operation per file. Names such as `get-element-at-position`, `find-unique-selector`, and `race-promise-with-abort` communicate behavior without opening the file.

Apply this to React Doctor:

- keep a utility only when it is stateless, domain-neutral, and independently testable;
- put domain operations in their domain, not in a global `utils` grab bag;
- use one focused utility per file;
- search with `truffler` before adding and after finishing any helper.

### Transactional state changes and explicit cleanup

The plugin registry prepares replacement state before committing it. If setup or recomputation fails, the current plugin remains active and the failed replacement is cleaned up. Page freezing similarly records cleanup functions and rolls back partial setup.

Apply this to React Doctor:

- build a scan plan before executing it;
- validate configuration before mutating caches or emitting output;
- treat cache writes, temporary files, subprocesses, telemetry scopes, and progress reporters as acquired resources with explicit cleanup;
- keep the previous valid state when a replacement fails;
- test partial failure and rollback, not only the happy path.

### Focused tests at the facade and mechanism levels

React Grab tests public primitives separately from private mechanisms, and tests plugin replacement, cleanup failure, ordering, immutable inputs, and legacy behavior. Its apps are realistic framework fixtures rather than production logic hidden inside tests.

Apply this to React Doctor:

- contract tests exercise published entry points;
- unit tests exercise pure domain operations;
- service tests exercise Effect layers;
- fixture apps and repositories exercise framework integration;
- regression tests name the compatibility behavior they protect.

### Performance is a design constraint

React Grab records hot-path rules in `AGENTS.md`, has dedicated performance tests, and makes allocation and scheduling choices explicit. Performance-sensitive code is recognized as a distinct kind of code.

Apply this to React Doctor:

- identify hot paths such as AST traversal, diagnostic filtering, path normalization, batching, and cache fingerprinting;
- benchmark before and after moving them;
- keep instrumentation at stable operation boundaries;
- do not trade a cleaner directory tree for slower scans or larger bundles.

### Build targets are explicit

React Grab centralizes shared pack options and declares the differences among browser globals, ESM/CJS modules, demos, and CLI bundles. Apps and fixtures remain outside the published library.

Apply this to React Doctor:

- give every published entry point an explicit build target;
- test packed artifacts, not only source imports;
- make Node-only, browser-compatible, CLI-only, and editor-only boundaries visible;
- keep fixture and evaluation dependencies out of production packages.

### What not to copy literally

React Grab still has very large orchestration and type files. The useful lesson is its facade, lifecycle, testing, and capability boundaries—not its current file sizes or every directory name.

## What is good in Bippy

### A very small conceptual center

Bippy has one job: safely expose React internals. Its source is divided into the core instrumentation surface and two clear capability areas, `source` and `react-refresh`.

Apply this to React Doctor:

- define the diagnostic engine's conceptual center in one sentence;
- group code by capability rather than by the order in which features were added;
- move optional capabilities behind explicit boundaries;
- keep adapters such as the CLI and language server out of the engine's domain model.

### Side-effect ordering is part of the contract

Bippy's default entry installs the hook before exporting core behavior, and the code records why React must not be imported first. The side effect is isolated in `install-hook-only`.

Apply this to React Doctor:

- isolate process-global initialization;
- make Sentry setup, console mutation, environment capture, cache initialization, and CLI instrumentation composition-root concerns;
- keep library entry points free of CLI-only side effects;
- add a comment only where the ordering constraint cannot be expressed by names or structure.

### Compatibility is represented as a matrix

Bippy runs the same renderer contract against several adapters. The shared harness verifies mount, inspection, update, unmount, identity, traversal, and instrumentation semantics.

Apply this to React Doctor:

- create shared contract suites for CLI modes, programmatic APIs, linters, project kinds, package managers, and editor clients;
- add adapters to the matrix instead of duplicating entire suites;
- use the matrix to prove that a rewritten implementation matches the legacy implementation.

### Cleanup composes

Bippy returns an `Unsubscribe` that is both callable and `Disposable`. Non-client environments receive a no-op implementation, so callers do not need environment branches.

Apply this to React Doctor:

- prefer interfaces that are safe in unsupported or disabled environments;
- use no-op layers for reporters, progress, analyzers, and observability;
- make acquired resources composable through Effect scopes or explicit disposables;
- keep environment checks at the implementation edge.

### Packaging is tested as product behavior

Bippy intentionally publishes ESM, CJS, IIFE, declaration files, and subpath exports while keeping React external. `publint` and build configuration protect that contract.

Apply this to React Doctor:

- snapshot package exports, declarations, bins, peer dependencies, and packed contents;
- verify both import and execution behavior;
- prevent internal refactors from silently changing bundle composition or side effects.

### Fragile integrations receive adversarial tests

Bippy tests missing hooks, non-configurable globals, several renderers, portals, React Refresh transports, source maps, and server/client differences.

Apply this to React Doctor:

- prioritize failure-mode coverage around git, worktrees, package managers, native bindings, config loading, partial lint failures, timeouts, cache corruption, and CI;
- use invariants and contract cases rather than implementation snapshots alone.

### What not to copy literally

Bippy intentionally accepts large core files because it mirrors unstable React internals. React Doctor has broader, separable domains and should not use that as permission to centralize unrelated behavior.

## Preferences retained from `AGENTS.md`

The rewrite must preserve the repository's stated engineering taste:

- use `@antfu/ni` for dependency operations;
- use interfaces for object contracts that callers construct, implement, or extend, and type aliases
  for unions, primitives, tuples, function signatures, derived types, and re-exports;
- keep shared declarations at module scope in their narrowest owner rather than adding ambient
  globals;
- prefer arrow functions when the language or framework does not require a declaration;
- use kebab-case filenames and descriptive variable names;
- avoid casts and non-null assertions;
- keep comments rare and explain only non-obvious constraints;
- keep constants beside their domain, extracting values whose meaning, unit, or reuse matters into
  domain `constants.ts` files with unit-bearing names;
- keep helpers beside a sole consumer and move only genuinely shared, domain-neutral leaves into a
  focused domain `utils` directory;
- search for reuse before implementation and check for duplication afterward;
- use Effect v4 module imports, tagged error reasons, services, layers, spans, and recovery idioms consistently;
- keep console behavior inside Effect's `Console` in Effect-typed code;
- run the product-thinking pass before any public-surface change;
- preserve anonymization and existing observability semantics;
- follow all testing and release-authorization requirements.

The rewrite should reduce the amount of convention that must be remembered. Important rules should become enforced dependency constraints, contract tests, generators, or shared harnesses.

## Current-state observations

The existing package split is directionally good:

- `@react-doctor/core` owns the engine;
- `@react-doctor/api` is the programmatic shell;
- `react-doctor` owns the CLI and public compatibility facade;
- `@react-doctor/language-server` owns editor protocol behavior;
- the oxlint and ESLint packages own rule integrations;
- fuzzing and evals are separate packages.

The main problem is not the names of the packages. It is that internal ownership is weak inside those boundaries.

Measured at commit `846c2df84465d6ebce31ea894669afc5c28ae01f`:

- the repository has 12 package directories;
- there are 6,377 tracked TypeScript/TSX files under `packages`;
- 1,392 tracked test/spec files provide a strong migration safety base;
- `packages/core/src` has 229 TypeScript files;
- `packages/react-doctor/src` has 212 TypeScript/TSX files;
- `packages/language-server/src` has 23 TypeScript files;
- `packages/core/src/index.ts` contains 108 `export *` declarations;
- `packages/react-doctor/src/inspect.ts` is 1,313 lines and has 48 top-level imports;
- a static relative-import analysis found a source-level cycle:
  `inspect.ts -> build-run-event.ts -> scan-result-cache.ts -> inspect.ts`.
  The last edge is type-only, but it still shows that the resolved scan contract is owned by an orchestration module instead of a neutral contract module.

Several large files combine multiple reasons to change:

- `inspect.ts` mixes option resolution, layer composition, scan execution, caching, rendering, onboarding, telemetry, and result shaping;
- `run-inspect.ts` coordinates many analyzer and failure policies;
- `project-info/detectors.ts` centralizes unrelated project-detection knowledge;
- `services/git.ts` combines capability definition, commands, parsing, diff policy, and implementation;
- broad barrels make private internals look equally important and obscure true dependencies;
- telemetry helpers import operational modules, while operational modules call telemetry helpers;
- types are sometimes owned by their current caller rather than by the capability they describe.

Large rule and fixture files are not automatically architectural problems. Generated registries, upstream fixtures, and intrinsically complex detectors need different treatment from a 1,000-line application orchestrator.

## Compatibility contract

Before moving implementation, freeze the current observable contract.

See [Compatibility guarantees and snapshots](compatibility.md) for the terminology, repository
layout, and update commands used by these gates.

### Published packages and modules

Preserve:

- package names, bins, export subpaths, module formats, declaration behavior, and packed file layout;
- `react-doctor`, `react-doctor/api`, `@react-doctor/api`, and the published lint plugin APIs;
- exported symbol names, call signatures, error classes, and legacy error behavior;
- supported Node and package-manager behavior.

Private packages still need internal contract tests because published packages depend on them.

### CLI

Preserve:

- commands, aliases, flags, defaults, precedence, validation, and deprecated inputs;
- interactive and non-interactive behavior;
- stdout/stderr routing, JSON silence, terminal color, and exit codes;
- ordering and wording where scripts or golden tests rely on them;
- cache, staged, diff, baseline, deadline, and CI-gating semantics.

### Wire formats

Preserve:

- JSON report schema versions 1, 2, and 3;
- diagnostic identity and ordering;
- rule IDs, metadata, severities, categories, tags, and score behavior;
- config file names, schema, merge precedence, and relative-path resolution;
- LSP diagnostics, diagnostic data, hovers, actions, and command behavior;
- GitHub Action inputs, outputs, environment forwarding, comments, and exit behavior.

### Telemetry and privacy

Preserve:

- span names and meaningful attribute types;
- wide-event and metric semantics;
- cache-temperature and failure classifications;
- Sentry/OTLP selection and trace linkage;
- path, secret, identity, and hostname scrubbing;
- true no-op behavior when telemetry is disabled.

## How the rewrite proves 1:1 compatibility

“No breaking changes” is an exact migration gate, not a reviewer judgment or a high test-coverage
claim. Each replacement must prove compatibility at four levels:

1. **Source contract:** existing exports, TypeScript signatures, errors, rule IDs, config fields,
   CLI inputs, and schema versions remain available. Additions use deliberate subpaths and preserve
   the old facade.
2. **Built artifact:** build and pack the real packages, install the tarballs into an empty project,
   import every affected subpath, and exercise the installed CLI/API. Source-only tests do not prove
   package compatibility.
3. **Behavior contract:** run the same characterization corpus before and after the change and
   compare the complete observable result, including diagnostics, ordering, locations, severity,
   suppression, score, output streams, exit status, errors, cache results, and editor protocol data.
4. **Differential contract:** while an implementation is being replaced, expose old and new
   implementations through the same adapter and compare exact canonical results. Switch the facade
   only at zero unexplained differences, then delete the old implementation in the same migration
   slice.

Every intentional difference needs a small reviewed allowlist entry containing an owner, rationale,
expiry condition, and removal issue. A broad “effectively identical” tolerance is not acceptable.
Normalize only nondeterministic fields that are already outside the product contract, such as
elapsed time or generated temporary paths; never normalize away a diagnostic or ordering mismatch.

Performance and resilience are part of compatibility. Each phase compares cold and warm wall time,
peak memory, crash/timeout classification, fallback behavior, and repeated-scan state. A cleaner
implementation does not ship if it materially regresses those budgets.

The minimum merge evidence for a slice is:

- focused unit/service tests for the new seam;
- the unchanged characterization or golden suite for the replaced behavior;
- exact old/new differential results where both implementations can coexist briefly;
- repository typecheck, lint, format, and full tests;
- JSON schema, generated-output, skill-tree, and package-boundary checks as applicable;
- built and packed installation smoke tests for every affected public package.

## Target architecture

Keep the current package boundaries, but make the engine's layers explicit.

```text
published adapters
  CLI / API / LSP / ESLint
          |
          v
application workflows
  resolve request -> plan scan -> execute -> assemble result
          |
          v
domain capabilities
  diagnostics / projects / configuration / scoring / suppression
          |
          v
service contracts
  files / git / linter / dead code / supply chain / reporter / progress
          |
          v
infrastructure layers
  Node filesystem / subprocesses / oxlint / HTTP / persistent caches
```

Dependency rules:

1. Contracts do not import application, CLI, telemetry, or infrastructure modules.
2. Pure domain modules import contracts and other pure domain modules only.
3. Effect service contracts describe capabilities and `ReactDoctorError` failures.
4. Infrastructure implements services and owns third-party integration details.
5. Application workflows coordinate domain operations through services.
6. API, CLI, and LSP are composition roots. They select layers and translate results to their public contracts.
7. Rendering and telemetry consume completed events/results; they do not own scan policy.
8. Compatibility facades may point inward. New internals never point back to a facade.

The exact directory names can evolve, but every module must have one architectural role.

## Migration strategy

Use a strangler migration:

1. characterize current behavior;
2. introduce a narrow internal contract;
3. build the replacement behind the existing function or entry point;
4. run old and new implementations against the same contract cases where practical;
5. switch the facade;
6. delete the replaced implementation immediately;
7. run deduplication and architecture checks.

Do not merge a second full implementation and defer deletion to an unspecified cleanup phase.

Each migration pull request should move one coherent vertical slice and remain independently releasable.

## Phased plan

### Phase 0: Freeze behavior and install guardrails

Deliverables:

- inventory every published package export, bin, CLI command/flag, config field, JSON schema version, Action input/output, LSP capability, rule ID, and environment variable;
- save packed-artifact manifests and declaration snapshots;
- create shared black-box contract suites for CLI, API, JSON reports, and LSP;
- record representative performance and memory baselines;
- add a dependency-cycle check and explicit allowed package edges;
- classify large files as generated data, complex detector, orchestration, facade, or mixed responsibility.

Exit gate:

- the current implementation passes all contract suites;
- compatibility can be evaluated automatically instead of by reviewer memory.

### Phase 1: Establish explicit contracts and break dependency cycles

Deliverables:

- move resolved scan option types out of `inspect.ts` into a neutral contract module;
- separate cache policy inputs from the entire resolved CLI option object;
- remove the `inspect -> build-run-event -> scan-result-cache -> inspect` source cycle;
- replace the `@react-doctor/core` catch-all barrel with deliberate internal capability entry points;
- retain the existing `@react-doctor/core` exports as a compatibility facade until all in-repo callers migrate;
- add import-boundary checks so contracts, domain logic, telemetry, and adapters cannot point backward.

Exit gate:

- zero source-level cycles in core, CLI, API, and LSP;
- no new imports from the broad compatibility barrel inside the monorepo;
- no public export change.

### Phase 2: Extract the stable domain model

Deliverables:

- give diagnostics, project information, configuration, scan planning, suppression, and scoring explicit owners;
- colocate each operation with its domain instead of leaving domain logic at the core root;
- distinguish runtime wire schemas from compile-time operation interfaces;
- centralize diagnostic identity, normalization, ordering, and severity policy;
- split project detection by capability while preserving one discovery facade;
- move domain constants next to their owning domains.

Exit gate:

- pure domain tests run without Node, subprocess, console, telemetry, or filesystem setup;
- domain modules have no adapter imports;
- old public types and schemas remain assignable and wire-compatible.

### Phase 3: Rewrite the scan application pipeline

Model the engine as explicit stages:

```text
resolve target
  -> discover project
  -> load and validate configuration
  -> build scan plan
  -> collect inputs
  -> execute analyzers
  -> normalize and suppress diagnostics
  -> compute completeness and score
  -> assemble result
```

Deliverables:

- replace the monolithic `run-inspect.ts` flow with stage modules and a small orchestrator;
- represent partial failures and skipped work as typed outcomes;
- make concurrency, deadlines, and fail-open behavior scan-plan policy;
- keep analyzer execution behind services;
- emit progress and reporter events from stage boundaries;
- retain `runInspect` as the compatibility facade.

Exit gate:

- old and new pipelines produce identical canonical results for the contract corpus;
- failure reason tags and legacy throws match;
- performance and memory stay within the Phase 0 budget;
- the orchestration file describes sequencing, not implementation details.

### Phase 4: Isolate infrastructure and caches

Deliverables:

- separate Files, Git, Project, Config, Linter, DeadCode, Score, SupplyChain, Reporter, Progress, NodeResolver, and StagedFiles contracts from implementation details where doing so clarifies ownership;
- keep the established Effect layer names and test-layer conventions;
- split git command execution, output parsing, and diff policy;
- give each cache one owner, schema, key builder, storage adapter, and invalidation policy;
- move module-global mutable state behind services, references, or explicit lifecycle objects;
- use scoped cleanup for temporary directories, subprocesses, and cache writes.

Exit gate:

- every infrastructure service has a production layer and focused test layer;
- corrupt, stale, missing, disabled, and partial cache cases have contract coverage;
- application code does not call Node APIs or third-party analyzers directly.

### Phase 5: Rewrite the CLI as an adapter

Split the current `inspect.ts` responsibilities into:

- request and option resolution;
- composition-root layer construction;
- scan execution;
- cache read/write coordination;
- result-to-view-model projection;
- terminal rendering;
- telemetry projection;
- onboarding and interactive flow.

Deliverables:

- make commands thin translators from Commander inputs to application requests;
- make rendering consume immutable view models;
- make telemetry consume immutable run events;
- make JSON mode and interactive UI alternate presenters over the same result;
- preserve `inspect()` and all CLI behavior through compatibility facades;
- isolate process mutation and Sentry setup in CLI bootstrap modules.

Exit gate:

- CLI contract and golden tests are unchanged;
- JSON mode performs no unintended writes to stdout/stderr;
- telemetry and rendering do not import the scan orchestrator;
- the CLI can run with capture/no-op services without global monkey patches except where compatibility requires them.

### Phase 6: Normalize rule implementation architecture

Migrate rule families incrementally rather than rewriting all rules at once.

Deliverables:

- define one rule contract and one registration path;
- separate syntax collection, semantic facts, decision logic, and diagnostic construction when rules are complex;
- reuse shared AST and control-flow utilities after `truffler` searches;
- keep generated registries generated;
- retain upstream fixtures separately from focused regression cases;
- use the rule research, writing, validation, eval, and fuzz pipeline for every migrated rule.

Exit gate:

- rule IDs, defaults, metadata, messages, severities, and fixes remain compatible;
- focused tests, fuzzing, local evals, and parity checks pass;
- complex rules expose testable facts and decisions instead of one large visitor.

### Phase 7: Simplify API, LSP, and other adapters

Deliverables:

- make `@react-doctor/api` a small Effect execution shell over the application workflow;
- preserve legacy error restoration at the outer boundary;
- make the LSP depend on stable application contracts, not CLI behavior;
- isolate editor scheduling, overlays, and protocol mapping from scan policy;
- keep ESLint as a translation layer over canonical rule behavior;
- ensure VS Code and Zed integrations consume the language-server contract only.

Exit gate:

- API and LSP shared contract matrices pass;
- adapters do not duplicate scan policy;
- package dependency direction matches the target architecture.

### Phase 8: Remove compatibility internals and finish

Deliverables:

- delete superseded modules, barrels, aliases, caches, and migration shims that are not public contracts;
- keep only public compatibility facades that still serve real consumers;
- rerun `truffler` over every migrated capability;
- update `AGENTS.md` so it describes the finished architecture rather than migration history;
- produce an architecture map and contributor guide;
- run the full repository validation and packed-artifact checks.

Exit gate:

- no legacy/new dual implementations;
- no source-level cycles;
- no unexplained cross-layer imports;
- public contract snapshots match the Phase 0 baseline;
- performance, memory, diagnostics, score, telemetry, and privacy gates pass.

## Quality gates for every phase

Run the repository-required checks:

```bash
nr test
nr lint
nr typecheck
nr format
nr smoke:json-report
```

Also run the checks appropriate to the changed surface:

- packed CLI installation and package-export checks;
- CLI golden and exit-code tests;
- API declaration and runtime contract tests;
- LSP protocol tests;
- Action rendering and normalization tests;
- targeted performance and memory benchmarks;
- rule fuzzing, evals, validation, and parity;
- `truffler` before and after implementation.

No phase may require a schema bump, rule rename, score change, new CLI flag, or Action release merely to enable the refactor. If a public change becomes desirable, treat it as a separate product change and run the product-thinking workflow.

## Review heuristics

Treat these as prompts for design review, not blind lint limits:

- a module with more than one unrelated reason to change should be split;
- an orchestration module should read primarily as sequencing;
- a facade should contain translation and delegation, not business logic;
- a utility should not know about CLI flags, Effect layers, telemetry, or package-specific policy;
- a type imported by several layers belongs in the lowest neutral owner;
- an optional subsystem should be replaceable by a no-op implementation;
- a failure path should be as explicit and tested as the success path;
- a moved implementation should result in deleted old code in the same phase;
- comments that narrate behavior indicate naming or structure should be improved first.

## Validation of proposed evaluator, package-model, and runner work

The proposals below were checked against the current implementation rather than accepted as a
single rewrite package. They do not all have the same confidence or dependency order.

### Decision summary

| Proposal                            | Decision                                        | Why                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public in-process rule runner       | Keep private pending broader evidence           | The production-owned evaluator now reuses the parser, traversal, scope, CFG, registry, and resource host, but publication would create a compatibility contract before Flow, fixes, secondary labels, open-source hits, and resource behavior are sufficiently characterized. |
| Virtual-project evaluation          | Continue incrementally                          | Multi-file execution now works through an injected resource host for 63 of 100 cross-file rules. Each remaining rule still needs a sound reachable primitive and bounded cache-dependency decision.                                                                           |
| Normalized package graph            | Implemented                                     | One graph now retains package identity, declarations, versions, provenance, workspace/catalog resolution, ownership, and package-local queries while legacy `ProjectInfo` remains an exact compatibility projection.                                                          |
| Capabilities derived from the graph | Implemented behind compatibility fields         | Package and project capability projections come from the same graph. Redundant legacy fields remain until a separately authorized compatibility migration can remove them.                                                                                                    |
| Package-aware rule context          | Implemented for migrated rule families          | The owning package now supplies dependency state without repeated nearest-manifest walks. Migration remains family-by-family so mixed-version monorepo corrections are not smuggled in as unexplained behavior changes.                                                       |
| In-process production backend       | Do not pursue now                               | The private evaluator is useful for tests, but the measured evidence does not justify replacing Oxlint and the evaluator still does not reproduce the complete production host contract.                                                                                      |
| Backend parity suite                | Implemented and continuing                      | Exact source-evaluator, virtual-host, real-filesystem, and built-Oxlint differentials now gate supported rules. Broader fixtures remain necessary before any production or public switch.                                                                                     |
| Subprocess-overhead benchmark       | Implemented                                     | Separate startup, parse-only, plugin-loaded, rule, and repository-scale cohorts show fixed initialization matters most on small batches and shrinks with workload size.                                                                                                       |
| Better concurrency controls         | Keep internal; defer a new CLI flag             | Numeric control already exists through `inspect({ concurrency })` and `REACT_DOCTOR_PARALLEL`. A `--workers` spelling is a separate product change; invocation-wide budgeting remains the more valuable internal seam.                                                        |
| Persistent worker pool              | Prototype complete; do not production-integrate | Reuse is much faster on small batches, but the prototype depends on unsupported minified Oxlint bindings and an explicit private rule-table reset. Fresh children remain the supported production backend and rollback path.                                                  |
| Runner-independent post-processing  | Preserved and tightened                         | Diagnostic filtering, suppression, severity, deduplication, sorting, scoring inputs, cache lifecycle, and result assembly now have characterized owners without pretending Oxlint-specific process recovery is backend-neutral.                                               |
| Two documented APIs                 | Defer until `evaluate` is ready                 | `diagnose` and virtual evaluation represent different jobs, but only `diagnose(directory)` should remain public until the supported-rule matrix and operational contract are stable.                                                                                          |

### What the repository already proves

#### The reusable evaluator core exists, but it is not a public contract

`packages/oxlint-plugin-react-doctor/src/test-utils/run-rule.ts` already:

- parses source with `oxc-parser`;
- attaches parents and source locations;
- dispatches enter and exit visitors;
- lazily builds the custom scope analysis and control-flow graph;
- accepts a filename and settings;
- supports reusing a parsed fixture across repeated rule runs.

It is used throughout rule tests, liveness checks, fuzzing, upstream fixture parity, and
function-mining workflows. This is strong reuse evidence.

It is not sufficient to export unchanged:

- callers pass a `Rule` implementation instead of stable rule IDs;
- it bypasses registry-level capability selection and several framework wrappers;
- it reports only message and node type, not the canonical `Diagnostic` record;
- it does not implement the production configuration, ignore, inline-disable, fix, plugin, and
  partial-failure contracts;
- cross-file helpers read the real filesystem;
- scan rules use a separate harness.

The reusable unit is therefore the parser/traversal/semantic engine underneath `runRule`, not
`runRule`'s current input and output types.

#### Project discovery is one pass, but not a package graph

`collectWorkspaceFacts` already evaluates the root and workspace manifests in one traversal.
Replacing it merely to avoid repeated workspace enumeration would not justify a migration.

The real limitation is information loss. The traversal immediately folds package-local facts into
one `WorkspaceFacts` aggregate using rules such as first-hit, any-hit, or lowest-version-wins. It
does not retain:

- every workspace package and its boundary;
- every dependency declaration and section;
- raw and catalog-resolved specs together;
- the declaring package for every fact;
- workspace-to-workspace dependency edges;
- enough provenance to answer the same query for the package that owns one file.

Catalog support already covers root catalogs, workspace catalogs, named catalogs, and
`pnpm-workspace.yaml`. A graph migration must preserve those precedence rules and should record
their provenance rather than replacing them with a simpler name-to-version map.

#### Package-local filesystem access is centralized more than the proposal implied

`read-nearest-package-manifest.ts` is already the single owner of nearest-manifest lookup and
caches both filename-to-package and directory-to-manifest results for a scan. Package-aware context
is still valuable for correctness and virtual evaluation, but it should not be sold primarily as
removing repeated uncached walks.

The wider virtual-project problem remains real: production plugin code reaches Node filesystem and
path APIs through cross-file parsing, import resolution, tsconfig aliases, framework layout probes,
package classification, suppression handling, and installed-package version resolution. A virtual
package graph alone does not virtualize those operations.

#### The backend and post-processing seams mostly exist

`Linter` is explicitly a cross-backend service whose current production layer is `layerOxlint`.
Adding a prototype backend does not require another orchestration abstraction.

The backend-neutral pipeline already owns:

- severity restamping and disabled rules;
- warning visibility;
- config, file, override, and inline suppression;
- file-context and app/library filtering;
- related-diagnostic deduplication;
- stable final sorting and fix grouping;
- surface filtering and scoring after collection.

Oxlint-specific code still owns config generation, child-process retries, plugin fallback, output
parsing, batch deduplication, per-file cache entries, and cross-file sidecar probes. Those concerns
depend on the backend's execution and invalidation model. Keep them in the backend until a second
implementation proves a shared contract.

#### Concurrency is already configurable, but not globally budgeted

Current controls include:

- `inspect({ concurrency })`;
- `REACT_DOCTOR_PARALLEL=N`;
- memory-and-core auto-sizing;
- the CLI's `--no-parallel`;
- a hard worker ceiling;
- parallel-resource fallback to one worker;
- binary-split retries and serial single-file OOM rescue.

The CLI scans up to four projects concurrently, while each project independently resolves its own
Oxlint worker count. That multiplication is the concrete oversubscription risk. A numeric CLI flag
alone does not solve it.

#### Existing benchmarks do not answer the backend question

The performance harness already compares:

- lint-only and full scans;
- cold and warm cache cohorts;
- explicit and automatic worker counts;
- wall time, throughput, and peak resident memory;
- CPU and heap profiles.

It does not isolate Node startup, plugin module evaluation, native binding load, project/config
preparation, parsing, and rule execution. Source comments contain useful observations about cold
spawn cost, but those are not a repeatable decision record.

### Recommended public evaluation API

The user job is: run canonical React Doctor rules deterministically on supplied source without
constructing a repository on disk.

Expose one additive `evaluate` API from `react-doctor/api`. Do not separately publish `runRule`,
parser objects, AST nodes, visitors, or arbitrary internal `settings`.

The intended model is:

```ts
evaluate({
  files,
  rules,
  project,
  config,
});
```

Where:

- `files` is one or more normalized virtual paths with source text;
- `rules` contains stable rule IDs or tags, not rule implementations;
- `project` supplies an explicit package/dependency model or an explicit capability set;
- `config` reuses the applicable public rule/severity/ignore settings rather than exposing the
  backend's raw settings bag;
- the result contains canonical `Diagnostic` records plus structured parse/evaluation failures;
- no score, dead-code result, supply-chain result, Git state, or repository discovery is implied.

A single source file is just a one-file virtual project. This avoids freezing two overlapping
public APIs into the package.

`evaluate` should initially support the rules whose dependencies are entirely source, semantic
analysis, capabilities, and supplied configuration. Cross-file and filesystem-sensitive rules must
either use the virtual host or return an explicit unsupported-rule result; silently running them
with partial semantics is unacceptable.

Compatibility requirements:

- `diagnose` remains unchanged;
- `evaluate` uses the same `Diagnostic` schema, rule IDs, metadata, messages, locations, severities,
  and suppression policy where the supplied inputs make those behaviors meaningful;
- existing internal `runRule` callers migrate through a compatibility wrapper;
- adding the published API is a separate product change and release decision, not an incidental
  rewrite step.

Product evidence to collect:

- opt-in `evaluate` operation duration, file count, and rule count through the existing
  observability path, without paths, source, package identity, or other sensitive values;
- number of eval/fuzz/regression workflows still creating temporary projects;
- diagnostic parity against Oxlint for the supported rule set.

Kill metric: if the API cannot remove most fake-project setup from eval/fuzz workflows, or if its
supported-rule parity cannot be kept exact without reproducing most of Oxlint, keep it internal
rather than maintaining a misleading public surface.

### Recommended package model

Create an internal immutable `PackageGraph` whose nodes retain at least:

- normalized package directory and optional package name;
- manifest location and package boundary;
- dependency declarations by section;
- raw spec, resolved spec, resolution source, and catalog reference;
- workspace edges and package ownership lookup for a file;
- package-local framework/dependency facts.

Queries should be pure and package-aware:

```ts
graph.findOwningPackage(filePath);
graph.getDependency(packageDirectory, dependencyName);
graph.hasDependency(packageDirectory, dependencyName, versionRange);
```

Do not make the graph public during the first migration. First derive the existing `ProjectInfo`
from it and prove byte-for-byte/field-for-field compatibility. Then derive the current capability
tokens from package-local facts while retaining the project-wide capability set for old callers.

Migration order:

1. build the graph beside `collectWorkspaceFacts`;
2. compare graph-derived legacy facts with current discovery across the project corpus;
3. make `ProjectInfo` a compatibility projection;
4. derive `hasX` values from version/declaration facts instead of storing both as independent truth;
5. add package-local capability queries;
6. move rule wrappers from nearest-manifest helpers to the package-aware context;
7. delete the superseded aggregation and filesystem helpers only after all consumers migrate.

Do not remove optional `ProjectInfo` fields during the compatibility-preserving rewrite. Mark
redundant fields as derived/deprecated and consider deletion only in a separately authorized major
release.

### Virtual host required for cross-file evaluation

Introduce a narrow resource contract before claiming virtual-project support:

- read source or manifest content;
- test file/directory existence;
- enumerate a bounded directory;
- resolve relative imports and tsconfig aliases;
- resolve the owning package and declared/installed dependency information;
- normalize paths consistently across real and virtual hosts.

Implement a real-filesystem host and an in-memory host against the same contract. Migrate
cross-file primitives, not individual rules, so one change unlocks several rules and keeps the
probe/caching model coherent.

The first virtual-project milestone should cover multiple files, relative imports, package
ownership, manifests, and tsconfig aliases. Installed `node_modules`, framework-generated layouts,
and arbitrary user plugins can remain explicitly unsupported until a concrete eval needs them.

### Backend parity contract

Build the suite before treating the in-process runner as a production candidate.

For the same corpus and resolved configuration, compare:

- rule identity, severity, message, help, and category;
- start/end line, column, offset, and length;
- ignored files, config overrides, and inline suppressions;
- parse failures and unsupported syntax;
- framework and package capability gates;
- cross-file outcomes;
- deterministic ordering and deduplication after the shared pipeline;
- crashes, timeouts, and partial-failure classification;
- cold/warm wall time and peak resident memory.

Use exact equality for supported semantics. Any intentional backend difference belongs in a small
reviewed allowlist with an owner and deletion condition; “effectively identical” must not become a
permanent tolerance for unexplained drift.

The corpus should combine focused fixtures, upstream rule fixtures, generated/fuzz cases, real
open-source hits, mixed-version monorepos, and known crash/OOM inputs.

### Backend decision gates

Extend the current performance harness to attribute:

1. parent scan planning and config generation;
2. child Node startup;
3. Oxlint wrapper and plugin import;
4. native binding load;
5. source discovery and parsing;
6. semantic/scope/CFG construction;
7. rule execution;
8. output serialization, transfer, parsing, and shared post-processing.

Measure cold and warm compile caches, one and automatic workers, small and large files, a
single-file diff, a typical repository, and a large monorepo.

Only proceed from an evaluator engine to a production in-process backend if:

- avoidable process/runtime overhead is a material share of real scan time;
- the prototype passes the parity contract;
- it improves wall time or memory without weakening crash isolation;
- maintaining the duplicated host semantics costs less than the measured benefit;
- the Oxlint rollback layer remains intact.

The official [Oxlint JS-plugin surface](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) is
still described as alpha. Its
[package](https://github.com/oxc-project/oxc/blob/main/npm/oxlint/package.json) currently publishes
configuration helpers while its N-API lint entry is an implementation detail, not a documented
programmatic runner. Do not couple React Doctor production code to that private entry point.

### Concurrency recommendation

Treat concurrency as a hierarchy governed by one budget:

```text
scan budget
├── active projects
└── lint workers allocated among those projects
```

The scheduler should guarantee at least one lint slot to an active project, cap the total active
Oxlint children across the invocation, and return/reassign slots when a project completes. Preserve
the existing per-batch deadline, split, serial fallback, and OOM rescue behavior.

If a numeric CLI control is approved, prefer `--workers N` because the performance harness already
uses that vocabulary. Keep `--no-parallel` as a compatibility alias for one worker, keep
`REACT_DOCTOR_PARALLEL`, reject contradictory flags, and define explicit flag-over-environment
precedence. Reuse the existing `workerCount` wide-event field and scan metrics; add no
high-cardinality metric.

Kill metric: revert dynamic allocation if it raises median wall time or peak memory on the standard
single-project and multi-project benchmark matrix, or increases partial/OOM fallback rates.

### Persistent workers are a conditional optimization, not architecture

Fresh children currently provide:

- crash and OOM isolation;
- automatic module/config/global-state reset;
- simple abort and timeout reclamation;
- bounded lifetime for parser/plugin memory.

A pool would need a request protocol, per-scan configuration isolation, explicit reset of every
module-level plugin cache, memory thresholds, worker recycling, abort semantics, version skew
handling, and parity for retry/fallback behavior. It also cannot reuse the current one-shot CLI
without either wrapping an unsupported Oxlint internal API or replacing the execution engine.

Revisit a pool only if phase attribution shows repeated startup/plugin/native loading is a dominant
remaining cost after compile caching and batch planning. Prefer a supported upstream long-lived
Oxlint API if one becomes public. Otherwise the in-process evaluator prototype is the more useful
experiment because it serves tests even if it never ships as the production backend.

### Revised sequence

1. Add phase-attributed benchmarks and freeze the backend parity corpus.
2. Build the internal package graph and prove legacy `ProjectInfo` equivalence.
3. Extract a backend-neutral evaluator engine from `runRule`, keeping the old harness as a wrapper.
4. Add the virtual resource host and migrate cross-file primitives incrementally.
5. Publish `evaluate` only after its supported/unsupported contract and diagnostic parity are
   stable.
6. Introduce package-local capabilities and migrate package-sensitive wrappers.
7. Add invocation-wide worker budgeting; consider a numeric CLI flag as a separate product change.
8. Prototype `Linter.layerInProcess` only if benchmark results justify it.
9. Choose Oxlint, in-process, or a hybrid from measured parity/performance evidence.
10. Consider persistent workers only if subprocesses remain and measured startup cost still
    dominates.

## Deep-clean and architecture audit

This audit extends the migration plan beyond the evaluator and package graph. It combines three
independent repository passes over architecture, guidance/skills, and dead or obsolete code.

The main conclusion is not that the package layout should be redrawn. The workspace dependency
graph is acyclic and directionally sensible: core owns the engine, the plugin owns rules, and API,
CLI, and editor adapters depend inward. The disorder comes from a smaller set of recurring
problems:

- broad facades let almost every layer see almost every internal;
- one concept is represented by several independently invalidated caches or project models;
- test and tooling packages bypass package boundaries to reach implementation files;
- orchestration modules own policy, state, rendering, and infrastructure at the same time;
- contributor and agent instructions duplicate mutable product behavior;
- compatibility code has no explicit removal ledger;
- central `constants.ts` and `utils/` rules create the dumping grounds they were intended to avoid.

The rewrite should fix those ownership failures incrementally. Moving all files or collapsing the
workspace would add risk without addressing them.

### Priority-zero cleanup

These are current defects or proven dead code, not speculative redesign.

| Finding                                                                                       | Evidence                                                                                                                                                                                                                                    | Action and proof gate                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The only production relative-import cycle crosses scan orchestration, telemetry, and caching. | `inspect.ts` imports `build-run-event.ts`; that imports `scan-result-cache.ts`; the cache imports `ResolvedInspectOptions` back from `inspect.ts`. A static SCC scan across 3,124 TS/TSX files found no other production cycle.             | Move the resolved-input contract to a neutral module and replace the cache's dependency on the complete options object with a narrow immutable cache-policy input. Add an import-cycle check.                             |
| Local and distributed React Doctor skills have drifted.                                       | The two `SKILL.md` files are identical, but `skills/react-doctor/references/explain.md` still recommends deprecated `--diff`, while the local copy uses `--scope changed`; the distributed copy alone contains newer file-context guidance. | Make `skills/react-doctor` the canonical product source, generate the local adapter, compare the complete trees in CI, and validate documented flags against CLI help/parser tests. Preserve both paths during migration. |
| The `ship` workflow names unavailable local workflows.                                        | `.agents/skills/ship/SKILL.md` invokes `/review` and `/babysit`, but neither skill exists in `.agents/skills`.                                                                                                                              | Replace the steps with installed review/CI workflows or add explicit dependencies. Exercise the workflow on a disposable branch without merging or publishing.                                                            |
| A retired rule and its skipped test remain indefinitely.                                      | The registry generator skip-lists `react-compiler-destructure-method` because its premise did not hold; its implementation and tests remain, and its regression is the repository's only unconditional `describe.skip`.                     | Delete the implementation, dedicated tests, skipped regression, and generator exception unless a named experiment has an owner, date, and success metric. Regenerate the registry and run rule tests.                     |
| One utility and three constants are unreferenced.                                             | Exact repository search found no consumers for `contains-non-deterministic-source`, `CASCADING_SET_STATE_THRESHOLD`, `TRIVIAL_DERIVATION_CALLEE_NAMES`, or `EXTERNAL_SYNC_HTTP_CLIENT_RECEIVERS`.                                           | Delete them in a focused cleanup change, then run generation, typecheck, focused tests, and the full test suite.                                                                                                          |
| The Cursor plugin manifest contains a broken asset reference.                                 | `.cursor-plugin/plugin.json` points to `packages/website/public/react-doctor-icon.svg`; there is no website package, and no repository code, docs, or workflow references the manifest.                                                     | Decide whether Cursor distribution is supported. Restore and validate the artifact if it is; otherwise delete the manifest. Do not retain broken marketplace metadata “just in case.”                                     |

### Guidance is an executable product surface

`AGENTS.md` is 419 lines and currently mixes five different lifecycles:

1. durable repository invariants;
2. mutable package topology;
3. Effect implementation patterns;
4. telemetry internals;
5. release command recipes and historical tag state.

That mixture has already produced contradictions and stale references:

- the file mandates `ni`/`nr` and later prescribes `pnpm test`, `pnpm lint`, and related commands;
- “interfaces over types” is absolute even though unions, derived types, and schema types require
  aliases;
- “keep all types in global scope” is ambiguous and conflicts with normal module-scoped types;
- every magic number is required to live in a central `constants.ts`, while core's file is already
  998 lines with 158 exports;
- every small helper is directed to `utils/`, while the three main utility roots contain hundreds
  of files;
- the package map omits current packages and its service count is stale;
- the canonical Effect and eval reference paths do not exist in a clean checkout;
- the observability section names at least one path that no longer exists;
- the safe release-approval rule is followed by wording that can be read as requiring a tag for
  every intermediate action-related commit.

Keep the root guide short and durable:

- package-manager and check commands;
- repository-wide naming and type rules that are not enforced mechanically;
- task routing to product, rule, validation, and deduplication skills;
- the no-breaking-change/public-contract rule;
- release, tag, publish, and merge approval safety.

Move the rest to owned references:

- package topology and boundaries to `docs/architecture/overview.md`;
- Effect conventions to a core-local guide;
- telemetry topology to a React Doctor observability guide;
- Action version history and commands to a release guide;
- rule implementation details to the existing rule skills.

Rewrite the style rules as enforceable intent:

- use interfaces for object shapes and aliases for unions, primitives, and derived types;
- keep reusable declarations at module scope, not “global scope”;
- keep constants and helpers beside their owning domain;
- centralize only genuinely shared policy or primitives;
- automate rules supported by the linter and remove duplicative prose.

`CLAUDE.md` and the tracked `.claude -> .agents` symlink are good thin adapters and should remain.
Do not recreate them as copied instruction trees. Before adding more symlinks, account for Windows
checkouts with `core.symlinks=false`.

Additional skill cleanup:

- split the current `improve-react` audit, reconcile, and execute behaviors into explicit modes or
  skills; it claims writes are confined to plans but creates and deletes a report elsewhere and
  later dispatches implementation;
- decide whether `improve-react` is intentionally distributed: the build copies it, but the
  installer only exposes `react-doctor`;
- repair stale paths and removed skill references in `product-thinking`;
- change “exactly one telemetry metric for every public change” to “define success and instrument
  when meaningful and privacy-safe”;
- pin and checksum, or vendor, the writing guidelines instead of executing instructions fetched
  from a mutable `main` branch;
- replace the manual `.gitignore` allowlist for every agent skill with a declared skill manifest
  and a validation check;
- add repo-owned skill-script tests to CI; the parity scripts' tests are currently only invoked
  manually from their skill.

Because installed skill text changes user and agent behavior, canonicalizing these files is a
public-surface change. Run the product-thinking and packaging checks even when the diff is “only
Markdown.”

### Establish a private rule-engine boundary

The evaluator proposal needs one prerequisite that was not explicit enough in the original plan.
The reusable parser/traversal/scope/CFG machinery should have a stable private owner before
`evaluate` is published.

The fuzz package declares the plugin root as its dependency but uses 43 deep source imports across
12 files to access rule internals and test utilities. Function-mining scripts do the same. This
means the test and improvement tooling is coupled to the plugin's directory layout, while core
domain modules import the full plugin root merely to obtain tokens or rule metadata.

Create two intentional seams:

1. a private rule engine/testkit containing parsing, traversal, scope, CFG, and the current
   `runRule` mechanism;
2. a side-effect-free contracts/catalog entry point containing framework tokens, capabilities,
   rule identities, and metadata.

Then:

- migrate fuzzing, evals, function mining, and rule tests away from source-deep imports;
- restrict the full plugin entry to the Oxlint/backend adapter;
- make the future public `evaluate` translate stable rule IDs and inputs into the private engine;
- keep raw rules, ASTs, parser objects, and visitor contracts private;
- add package-export and packed-artifact tests so the new entry points do not accidentally load or
  bundle the full plugin.

The core barrel remains a compatibility facade during the rewrite, but new monorepo code should
use narrow internal entry points. It currently has 108 star exports and is imported broadly by API,
CLI, LSP, and tests; deleting it first would create a mass-movement diff without improving
ownership.

### Unify project ownership across batch, editor, and rule contexts

The language server has a directory-only `ProjectGraph` that indexes React roots and performs
deepest-prefix ownership. Core discovery independently walks manifests and computes workspace
facts. The planned normalized `PackageGraph` should replace both sources of package ownership:

- `PackageGraph` owns packages, boundaries, dependency declarations, resolution provenance, and
  `ownerOf(file)`;
- legacy `ProjectInfo` remains a compatibility projection;
- the LSP projects its workspace view from the graph rather than maintaining a separate graph with
  the same name;
- package-local rule capabilities query the graph;
- real and virtual resource hosts share the same ownership contract.

Dual-run old and new LSP ownership lookups before switching. Manifest change, package add/remove,
workspace config change, and symlink cases need explicit invalidation tests. This connects the
package-graph work to editor correctness rather than treating it as a CLI-only discovery rewrite.

### Give state and caches explicit owners

Module-level state is not automatically wrong. Immutable lookup maps and WeakMaps keyed by an AST
or analysis object have clear lifetimes. The problem is mutable state whose owner or invalidation
scope is unclear.

Current examples include project/config/package caches, role and ignore caches, file fingerprints,
toolchain versions, worker-slot budgets, JSON-mode console state, spinner state, Sentry run/project
context, active traces, initialization flags, and compatibility clear hooks.

There are also two persistent lint caches:

- core stores raw per-file diagnostics with its own schema and cache-directory policy;
- LSP stores processed diagnostics in a second schema and can fall back to a predictable SHA-1
  directory under shared temporary storage.

The LSP invalidation path clears a different set of caches from the public API and currently omits
the package-role cache. Both paths call `clearAutoSuppressionCaches`, which is now an intentional
no-op compatibility symbol.

Introduce explicit lifecycle owners:

```text
Process state
├── immutable registries and validated toolchain facts
Invocation session
├── run identity, telemetry context, renderer mode, worker budget
Project session
├── package graph, config, ignore policy, package roles
└── backend cache namespace and file fingerprints
Analysis state
└── AST, scopes, CFG, and rule-local WeakMaps
```

For every cache, record owner, key, value, maximum size, invalidation signals, persistence format,
and privacy boundary. Then:

- add one core cache/session facade used by API and LSP;
- stop adding calls to the public `clearCaches()` grab bag;
- preserve public no-op compatibility exports but remove internal dependence on them;
- reuse core's cache location, schema validation, atomic-write, and namespace policy in the LSP;
- shadow-measure the outer LSP cache before deciding whether its orchestration shortcut is worth
  retaining;
- test repeated and concurrent scans in one process;
- make the CFG block counter analysis-local even though the current synchronous reset makes it
  deterministic today.

This work is a prerequisite for a persistent worker pool. A pool cannot be safe while a fresh
process is the only reliable reset mechanism.

### Complete the service boundary around project checks

`runInspect` uses services for most infrastructure but directly imports and invokes several
environment/project checks, and forks the security check separately. Those checks perform Node I/O
and third-party parsing behind what otherwise appears to be an application orchestrator.

Add a `ProjectChecks` or environment-analyzer service with:

- a Node production layer;
- an in-memory deterministic test layer;
- one normalized result contract;
- explicit ordering and fail-open/fail-closed behavior.

Do not combine Linter, DeadCode, or SupplyChain into that service. Their timeout, caching,
isolation, and partial-failure policies are meaningfully different. This seam makes both the
stage-based scan rewrite and virtual-project tests more coherent.

### Make the programmatic API have one canonical owner

`packages/api` owns `diagnose` and selected exports, while `packages/react-doctor/src/index.ts`
duplicates much of the facade and separately owns `clearCaches` and JSON conversion before
re-exporting `diagnose`.

Make `@react-doctor/api` the canonical implementation owner. Keep `react-doctor/api` as the
published compatibility facade and preserve its generated declaration/runtime shape. Add
`evaluate` to the canonical API only after the private engine is stable, then project it through
the published facade.

As part of the compatibility baseline, replace `Schema.Unknown` for JSON report `score` with its
real schema. Add the legacy `ProjectInfo` schema when the graph projection exists. Include
compile-time parity assertions between wire schemas and TypeScript interfaces and keep decoding
historical reports.

### Consolidate build and packaging policy

Package Vite configurations repeat package-version reads, test timeouts, and overlapping
`neverBundle` lists. The React Doctor config repeats runtime external lists across CLI, API, and
LSP outputs. Published dependency correctness is therefore manually synchronized across:

- package manifests;
- several Vite configurations;
- `check-published-deps`;
- packed-install smoke tests.

Create a small build-policy module for:

- package-version loading;
- shared test timeout constants;
- engine, CLI, and LSP runtime external groups;
- packed dependency assertions.

Keep artifact-specific differences explicit; do not replace the lists with one universal external
set. Assert the packed tarball's exports, required runtime dependencies, startup behavior, skills,
README assets, and absence of private source.

Only the React Doctor package build consumes root `skills/**`, but the generic Turbo `build` input
applies it to every package. Move that invalidation to a package-specific task if Turbo's
configuration supports it.

The root and package React Doctor READMEs are identical tracked copies. Generate the package copy
from one canonical source. The package README references relative assets that are not included in
the package's `files` list; either ship those assets or use stable absolute URLs, and prove the
result from the packed tarball.

### Decompose by capability, not file length

File size is a signal, not a deletion or split rule. Generated registries, upstream fixtures, and
data tables should not be hand-split merely because they are large. Mixed change reasons are the
real criterion.

Highest-value capability splits:

| Module                                 | Current mixed responsibilities                                                                       | Intended seams                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `project-info/detectors.ts`            | TypeScript target, framework, React Compiler, and Next config detection                              | One detector per capability family plus a small discovery facade                 |
| `services/git.ts`                      | service contract, command execution, revision policy, diff parsing/selection, and GitHub-host lookup | pure revision/diff policy, command adapter, Git service, repository-host service |
| `run-oxlint.ts`                        | planning, file sizing, sidecar selection, cache, batching, retry, and result assembly                | backend planner, execution strategy, cache adapter, result assembler             |
| `run-inspect.ts`                       | stage orchestration plus concrete check policy                                                       | stage functions over explicit immutable state and services                       |
| CLI `inspect.ts`                       | option resolution, project scheduling, rendering, telemetry, and cache behavior                      | command adapter, invocation scheduler, renderer, telemetry hooks                 |
| LSP `server.ts`                        | protocol bootstrap, workspace lifecycle, document sync, diagnostics, hover, and fixes                | composition root plus focused feature handlers                                   |
| `deslop-js` entry collection           | framework exclusions, source collection, entry discovery, and tool/test-runner detection             | entry-source providers with an explicit registry                                 |
| `effect-needs-cleanup`                 | several resource models and proof engines in one rule                                                | resource facts, proof modules, React-ref lifecycle, thin rule adapter            |
| `window-open-without-noopener`         | origin, handle, and feature-provenance analyses                                                      | focused analyzers plus cross-file host adapter                                   |
| `nextjs-async-dynamic-api-not-awaited` | API catalog, flow analysis, and reporting                                                            | static contract catalog, flow engine, report adapter                             |

Keep a facade with the old imports during each move, migrate callers, and delete the facade only
when it is no longer part of a compatibility contract. Do not impose arbitrary line-count limits.

### Rebuild the test architecture around contracts

Large test files currently mirror large implementation files, and many rule/eval paths construct
temporary projects and manifests. Split tests by behavioral contract, not by an arbitrary number
of cases:

- engine tests: parser, visitor ordering, scopes, CFG, and location contracts;
- rule tests: source and semantic behavior through the private testkit;
- virtual-project tests: imports, aliases, manifests, package ownership, and cross-file rules;
- filesystem integration tests: discovery, ignores, symlinks, installed dependency resolution,
  and cache invalidation;
- backend parity tests: Oxlint versus in-process candidates;
- packed-product tests: exports, CLI startup, dependencies, assets, and installed skills.

Use typed case tables and focused fixture builders. Keep real filesystem tests for filesystem
contracts; `evaluate` should remove fake repositories from semantic rule tests, not make real-host
coverage disappear.

Generated code must have a deterministic freshness check. The generated rule registry is live and
should not be manually simplified, but its generator/check should fail CI when the checked-in
output is stale.

### Decide ambiguous product boundaries instead of calling them dead

Some code looks detached because it belongs to a second product or an unpublished adapter:

- `deslop-js` and `deslop-cli` are published packages with a separate test script;
- the VS Code extension is a private workspace package;
- the Zed extension is a standalone Rust crate intentionally excluded from JS workspace tooling;
- `improve-react` is copied into the npm artifact but not exposed by the supported installer.

For each, write a one-paragraph ownership decision:

- supported user job;
- release channel and compatibility promise;
- test/CI owner;
- dependency direction;
- removal or graduation condition.

If deslop is an independent product, give it an independent bounded context, checks, README, and
release policy. If it is only React Doctor's dead-code engine, plan a compatibility-preserving
transition to a private internal package rather than letting two published packages drift.

If Zed remains experimental, add a Rust check and a manual release owner; otherwise archive it.
Its exclusion from JS lint/format is intentional and is not evidence that the files are dead.

### Compatibility-debt ledger

Compatibility branches should be centralized and time-bounded without being removed during this
rewrite. Seed the ledger with:

- the legacy `mergeAndFilterDiagnostics` array wrapper and no-op
  `clearAutoSuppressionCaches`;
- hidden CLI aliases `--diff` and `--fail-on`;
- Sentry configuration re-exports from `instrument.ts`;
- host-version compatibility such as ESLint's `getFilename`;
- broad package barrels and the duplicate React Doctor API facade.

Each entry should record public surface, replacement, first deprecated version, usage signal,
removal condition, earliest major version, and owner. New implementation code may not depend on a
compatibility shim. Removal still requires the separately authorized breaking release.

### Deep-clean execution order

1. Delete the proven unreferenced utility/constants and resolve the retired rule.
2. Fix the broken Cursor manifest decision and package README assets.
3. Canonicalize distributed skills and repair broken/stale workflows.
4. Replace root `AGENTS.md` with a durable index and move owned references.
5. Add import-boundary, generated-output, skill-tree, packed-artifact, and agent-tooling checks.
6. Break the scan/cache/telemetry cycle and establish narrow contract modules.
7. Extract the private rule-engine/testkit and side-effect-free rule catalog.
8. Add one cache/session lifecycle owner and reconcile LSP/core caching.
9. Build the package graph and project the LSP, legacy `ProjectInfo`, and rule capabilities from it.
10. Add the project-check analyzer seam and stage-based scan application.
11. Make `@react-doctor/api` canonical, then introduce virtual `evaluate`.
12. Decompose the ranked mixed modules one capability at a time.
13. Revisit the production backend and persistent workers only after parity and phase-attributed
    benchmarks.

Every cleanup change should identify one deletion or ownership simplification, preserve the
contract baseline, and avoid mixing unrelated moves. A refactor that only adds wrappers, adapters,
or parallel representations without a dated deletion step is incomplete.

### Implementation log

#### 2026-07-27: behavior-neutral cleanup batch

Completed:

- deleted the retired, unregistered `react-compiler-destructure-method` rule, its dedicated tests,
  the only unconditional skipped regression suite, and the generator exception;
- deleted the unreferenced `contains-non-deterministic-source` utility and three unreferenced
  constants;
- introduced `ScanResultCachePolicy`, removing the production import cycle between scan
  orchestration, run-event construction, and scan-result caching;
- introduced `clearCoreCaches()` as the single internal invalidation facade used by both the public
  React Doctor API and the language server;
- added the previously missing package-role invalidation to LSP project refresh;
- removed internal calls to the no-op `clearAutoSuppressionCaches` compatibility export while
  preserving the export itself.

Parity evidence:

- the generated registry remains at 781 active rules with no unrelated generated diff;
- all 15 repository test tasks passed;
- plugin: 24,791 passed, 201 skipped;
- core: 1,786 passed;
- React Doctor: 2,339 passed, 24 skipped;
- language server: 66 passed;
- API: 19 passed;
- fuzz harness: 192 passed, 782 opt-in fuzz cases skipped;
- evals: 60 passed;
- repository typecheck, lint, formatting, and JSON-report smoke validation passed;
- exact-symbol searches found no live references to the deleted implementation;
- the remaining rule-name occurrence is historical changelog text.

#### 2026-07-27: contracts, project model, and service-boundary batch

Completed:

- added a side-effect-free `oxlint-plugin-react-doctor/contracts` entry and migrated core's shared
  framework, capability, severity, and motion-library imports away from the 6.77 MB plugin entry;
- preserved the same values on the legacy plugin root and added identity assertions between both
  paths;
- added a packed-install assertion that imports the new contracts subpath from the actual tarball;
- introduced the first internal `PackageGraph` slice with ordered package boundaries, owning-package
  lookup, every dependency declaration, raw and resolved specs, declaration section, catalog
  reference, and resolution provenance;
- made the existing workspace-fact reducer consume the graph's sorted, deduplicated package
  traversal without changing the legacy `ProjectInfo` surface;
- introduced `ProjectChecks` with Node and deterministic test layers, moved the five synchronous
  project checks behind it in their existing order, retained diff-mode skipping, and kept security,
  lint, dead-code, and supply-chain policies separate;
- made `skills/react-doctor` canonical, added deterministic full-tree synchronization and CI
  mismatch checks for the local adapter, replaced stale `--diff` guidance with `--scope changed`,
  and preserved both installation paths;
- added patch changesets for the two additive published-package changes.

Parity evidence:

- all 15 repository test tasks passed;
- React Doctor: 2,342 passed, 24 skipped;
- plugin: 24,793 passed, 201 skipped;
- the project discovery characterization matrix passed 330 focused graph/discovery cases;
- the generated registry remains at 781 active rules;
- all 16 typecheck tasks passed;
- lint passed with only the repository's existing fuzz-fixture warnings;
- formatting and JSON-report schema smoke validation passed;
- all 9 build tasks and all 5 published-dependency checks passed;
- the packed CLI/plugin/deslop installation smoke passed and produced a schema-valid report;
- the lightweight contracts runtime is approximately 0.60 kB across its entry and shared chunk;
- the React Doctor skill adapter mismatch count is zero;
- post-change `truffler` searches found no competing contracts, package graph, or project-check
  abstraction.

#### 2026-07-27: graph queries, private engine seam, and compatibility guardrails

Completed:

- extended `PackageGraph` with package versions, root identity, workspace-protocol edges, resolved
  workspace targets, indexed dependency lookup, and package-scoped `hasDependency` range queries;
- preserved declaration precedence and made version evidence conservative for unresolved catalogs,
  tags, Git sources, invalid ranges, and unversioned workspace packages;
- added a private rule-engine testkit facade over the existing parser, visitor, scope, CFG, and
  rule runner, then migrated fuzzing away from scattered deep imports without publishing the
  facade;
- deleted the redundant test-only parent-reference helper and reused the production implementation;
- consolidated two iterative Tarjan implementations behind one tested strongly-connected-component
  utility;
- added a parser-backed source-architecture check that rejects runtime import cycles and forbidden
  backward edges while handling type-only imports, dynamic imports, re-exports, extensionless
  indexes, and NodeNext JavaScript-to-TypeScript resolution;
- added a reviewed public-package contract snapshot for all five published packages and shared
  package-manifest discovery between the contract and dependency checks;
- placed architecture, package-contract, and canonical-skill checks before the aggregate repository
  checker so structural drift fails early with focused output.

Parity evidence:

- all 15 repository test tasks passed;
- React Doctor: 2,342 passed, 24 skipped;
- plugin: 24,794 passed, 201 skipped;
- fuzz harness: 192 passed, 782 opt-in fuzz cases skipped;
- evals: 60 passed;
- all 16 typecheck tasks passed;
- lint passed with only the repository's intentional fuzz-fixture warnings, and all 5,790 formatted
  files matched;
- the architecture guard parsed 2,102 production source files with zero violations, and its four
  resolution/edge-classification tests passed;
- all five public package manifests matched the reviewed contract snapshot;
- all nine build tasks and all five published-dependency checks passed;
- JSON-report and packed-install smoke tests passed; the packed install produced 201 diagnostics
  with zero forbidden package imports and loaded the new contracts subpath;
- the generated registry remains at 781 active rules with no generated diff;
- the canonical React Doctor skill and local adapter have zero mismatches;
- post-change `truffler` searches found no competing package-graph query, SCC, package-discovery, or
  rule-engine-testkit abstraction.

#### 2026-07-27: graph projection, output finalization, and installed-product contracts

Completed:

- made `PackageGraph` the single manifest-backed source for project discovery, legacy
  `ProjectInfo`, and capability projection while preserving the public `ProjectInfo` shape;
- retained exact package identity with an explicit root package, package-local dependency facts,
  declaration-section precedence, catalog provenance, workspace edges, and deepest owning-package
  lookup;
- made manifest-backed React subproject discovery consume the graph while retaining the bounded
  standalone crawl and package-less pnpm and Nx fallbacks;
- added a field-for-field snapshot matrix for React, React 17, React 19, component-library, Next,
  TanStack Start, mixed React Native/web, pnpm catalog, Bun catalog, and non-React projects;
- added LSP ownership and invalidation coverage over the same package-boundary model;
- extracted backend-neutral terminal diagnostic finalization from `runInspect`, preserving analyzer
  merge order, fix-group assignment, stable sorting, and score-surface filtering;
- replaced the 419-line root `AGENTS.md` with a 35-line binding index and six owned references for
  coding, architecture, Effect, observability, testing, and release safety;
- added exact installed-CLI help baselines for 28 commands, aliases, implicit-help routes, hidden
  compatibility surfaces, and legacy flags without normalizing indentation, wrapping, or ordering;
- added installed-tarball contracts for all five published packages and eight export subpaths,
  including runtime export keys, declaration targets, bins, required files, allowed files, and
  denied private artifacts;
- treated the bundled `react-doctor` root as an execution-only entry so compatibility checks do not
  freeze minified implementation symbols, while keeping `react-doctor/api` exports exact.

Parity evidence:

- all 15 repository test tasks passed;
- core: 1,817 passed;
- React Doctor: 2,342 passed, 24 skipped;
- language server: 67 passed;
- plugin: 24,794 passed, 201 skipped;
- fuzz harness: 192 passed, 782 opt-in fuzz cases skipped;
- evals: 60 passed;
- deslop-js: 519 passed; deslop-cli: 15 passed;
- all 16 typecheck tasks passed;
- lint passed with only the intentional fuzz-fixture warnings, and all 5,809 formatted files
  matched;
- the source-architecture guard parsed 2,103 production files with zero violations, and all four
  guard tests passed;
- the generated registry remains at 781 active rules with no generated diff;
- all nine build tasks, five published-dependency checks, the JSON-report smoke, skill parity, and
  package-contract checks passed;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- post-change `truffler` searches found no competing output-finalization, package-graph,
  CLI-normalization, export-resolution, or strongly-connected-component abstraction.

#### 2026-07-27: evaluator seam, CLI graph convergence, scan assembly, and overhead measurement

Completed:

- added a private `evaluateSource` contract over the existing parser, visitor, scope, CFG, and rule
  runner rather than introducing a second engine;
- preserved raw rule IDs, deterministic duplicate ordering, settings-driven recommendations,
  one-based locations, UTF-8 offsets and lengths, and explicit parse, unknown-rule,
  unsupported-rule, and rule-crash failures;
- kept scan and cross-file rules explicitly unsupported until a virtual project host exists, kept
  the evaluator out of package exports, and preserved the legacy `runRule` result shape;
- moved CLI workspace selection and owning-project lookup onto `PackageGraph`, including exact
  workspace pattern order, deepest React-package ownership, and the existing standalone,
  package-less pnpm, and Nx fallbacks;
- made React-package selection use an explicit graph predicate while retaining the existing
  dependency-section semantics and public `listWorkspacePackages` helper;
- extracted pure `assembleInspectOutput` mapping from `runInspect` while leaving analyzer joins,
  reporter finalization, diagnostic finalization, score computation, refs, and events in their
  existing effectful owners;
- added an opt-in Oxlint overhead harness that directly measures bare Node startup, plugin import,
  native Oxlint startup, zero-rule parsing, plugin-loaded zero-active-rule scans, and a
  representative one-rule scan;
- labels median differences as inferred residuals and documents that the current subprocess
  interface cannot isolate a pure parser or rule-execution boundary;
- made exact CLI help contracts part of the aggregate `check` command, added an explicit packed
  contract update command, and documented all structural and installed-product gates in the
  testing reference.

Parity evidence:

- all 15 repository test tasks passed;
- core: 1,826 passed;
- React Doctor: 2,351 passed, 24 skipped;
- language server: 67 passed;
- API: 19 passed;
- plugin: 24,801 passed, 201 skipped;
- fuzz harness: 192 passed, 782 opt-in fuzz cases skipped;
- evals: 60 passed;
- deslop-js: 519 passed; deslop-cli: 15 passed;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with only intentional fuzz-corpus warnings, and all 5,817 formatted files matched;
- the aggregate `check` command passed end to end when its output was captured to a regular log;
  streaming all 193 intentional warnings through Vite+ can trigger its stdout `EAGAIN` panic;
- the source-architecture guard parsed 2,105 production files with zero violations, and all four
  guard tests passed;
- all five public package contracts, both CLI contract tests, the 781-rule generated registry, and
  canonical skill synchronization passed;
- all five published packages declared their runtime dependencies;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- a one-sample harness smoke completed every phase; its timings are only an execution check, not a
  backend decision baseline;
- post-change `truffler` searches found no competing evaluator, package ownership, inspect-output
  assembly, or subprocess-overhead abstraction.

#### 2026-07-27: virtual resources, package-local context, scan planning, and build hygiene

Completed:

- added a private resource-host contract with real-filesystem and in-memory implementations for
  normalized paths, bounded deterministic listings, source and manifest reads, relative and
  tsconfig-alias resolution, package ownership, dependency declarations, and installed versions;
- moved the existing relative-import resolver behind that shared mechanism while retaining its
  cwd-relative inputs, native-path outputs, cross-file probe recording, and package-entry behavior;
- kept the virtual host and evaluator private, and kept `evaluateSource`'s explicit cross-file-rule
  rejection until scan rules can consume the host without a second execution engine;
- added memoized package-local capability queries to `PackageGraph` by package directory and file,
  with deepest-boundary ownership and conservative unresolved catalog and workspace handling;
- reused the canonical capability projector, extracted shared dependency vocabularies and
  preferred-dependency selection, and retained the complete legacy project-wide `ProjectInfo`
  projection;
- extracted dead-code enablement, overlap, and concurrency allocation into a pure scan-plan stage
  while retaining `runInspect` as the compatibility facade;
- centralized the six published-package Node build target, shared test timeout, runtime external
  sets, and adjacent package-version reading without changing any resolved build configuration;
- tightened the Node-support guard to pin the central Node 20 target and require every package
  build, including the language server, to consume it;
- audited 6,597 files and 8,791 exports with the repository's own analyzer, treated generated
  registries, fixtures, fuzz corpora, and package entry files as owned inputs, found no production
  unused files after those exclusions, and removed 13 exports only after exact-reference checks;
- evaluated consolidating cache and JSON helpers into `@react-doctor/api`, but rejected that public
  surface change: it would create a permanent compatibility obligation without a credible
  privacy-safe adoption metric, so the existing exports remain unchanged.

Parity evidence:

- an independent compatibility review found no build, scan-policy, export, or cleanup drift;
- all 15 repository test tasks passed: core 1,833, React Doctor 2,351 with 24 skipped, plugin 24,805
  with 201 skipped, language server 67, API 19, fuzz 192 with 782 opt-in cases skipped, and evals 60;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks passed;
- lint passed with only intentional fuzz-corpus warnings, and all 5,842 formatted files matched;
- the aggregate `check` command passed end to end with its warning-heavy output captured to a
  regular file;
- the source-architecture guard parsed 2,120 production files with zero violations, and all four
  guard tests passed;
- real and in-memory resource hosts passed the same complete contract snapshot, and the real host
  matched the legacy relative and tsconfig resolvers;
- package-local fixtures proved distinct React 18/Vite, React 19.1/Expo 54, and React 19.2/Next 16
  contexts while the legacy project-wide snapshot retained its conservative aggregate behavior;
- all six package build configurations retained exact external ordering, Node targets, timeouts,
  and version substitution; the build-policy tests passed;
- all nine build tasks, five published-dependency checks, five public package contracts, exact CLI
  help contracts, canonical skill synchronization, and the 781-rule generated registry passed;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- post-change `truffler` and exact-symbol searches found no competing resource host, package
  capability adapter, scan plan, package-version reader, or remaining consumer of removed exports.

#### 2026-07-27: virtual project execution and compatibility-safe package context

Completed:

- promoted the private single-source evaluator into a shared multi-file execution path without
  exposing a new package entry point;
- added `evaluateProject` for an arbitrary resource host and `evaluateVirtualProject` for in-memory
  files plus explicit package manifests and installed dependency versions;
- bound resource hosts to synchronous rule execution through one scoped context and routed relative
  imports, absolute module resolution, tsconfig aliases, source parsing, nearest manifests, package
  ownership, and dependency lookup through the active host while retaining the real-filesystem
  fallback;
- kept scan rules unsupported and replaced blanket cross-file enablement with an explicit audited
  allowlist; the first supported cross-file rules are `no-mutating-reducer-state` and
  `no-indeterminate-attribute`, while a direct-filesystem rule is pinned to an
  `unsupported-rule` result;
- added real-temporary-project versus in-memory differential coverage for an imported reducer,
  including extensionless resolution, diagnostic locations, messages, and failure shape;
- cached the discovered package graph privately and added stable package-context serialization with
  owning-package capabilities and raw/resolved dependency declarations;
- added typed package dependency and capability queries to rule context plus universal
  package-local `requires` / `disabledWhen` enforcement behind a private opt-in;
- kept the default Oxlint configuration exactly equal with or without a cached package graph:
  package settings and capability gates are omitted unless the experiment is explicitly enabled,
  preserving diagnostics, ruleset hashes, and warm-cache keys;
- extracted lint file-coverage normalization from `runInspect` into a pure stage with characterized
  candidate, analyzed, total-count, and fallback-path precedence;
- audited production source reachability again, found no safely dead source files after package,
  worker, editor, and LSP entries were accounted for, and removed seven redundant
  implementation-only Language Server interface exports.

Parity evidence:

- all 15 repository test tasks passed: core 1,838, React Doctor 2,351 with 24 skipped, plugin
  24,815 with 201 skipped, language server 67, API 19, fuzz 192 with 782 opt-in cases skipped, and
  evals 60;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks passed;
- lint passed with only the intentional fuzz-corpus warnings, and all 5,855 formatted files
  matched;
- the source-architecture guard parsed 2,129 production files with zero violations, and all four
  guard tests passed;
- the legacy Oxlint config equals the package-graph-supplied default config exactly, including the
  absence of package-context settings and the unchanged rule map;
- real and virtual execution produced exactly equal diagnostics for the supported cross-file
  fixture, and an unaudited direct-filesystem rule remained explicitly unsupported;
- the Language Server declaration build proved the seven localized interfaces were never part of
  its public entry point;
- all five public package contracts, both CLI contracts, both build-policy tests, skill
  synchronization, and all five published dependency checks passed;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- post-change `truffler` and exact-reference searches found one resource-host context, one virtual
  rule allowlist, one package-context resolver, one file-coverage resolver, and no competing dead
  production files.

#### 2026-07-27: exact evaluator parity, post-processing contracts, and concurrency audit

Completed:

- added an enforced compatibility-delta ledger to `compatibility/approved-deltas.json`; every
  nonzero migration delta must now provide an ID, owner, scope, rationale, observed difference,
  expiry condition, and removal issue, while the accepted ledger remains empty;
- made the ledger validator part of both `compatibility:check` and the aggregate `check` command;
- extracted score-request metadata assembly from `runInspect` and characterized exact key order,
  nullish omission, and defined empty-string preservation;
- extracted the CLI's changed-line diagnostic filter while preserving relative/absolute path
  handling, slash normalization, duplicate-entry last-write behavior, multiline intersection, and
  stable diagnostic order;
- routed the current-source readers used by React Hooks suppression and dynamic-import annotations
  through the active resource host while preserving their hostless filesystem/cache paths;
- audited and enabled virtual execution for `exhaustive-deps`, `rules-of-hooks`, and
  `no-dynamic-import-path`, with exact real-directory versus in-memory differential results;
- corrected the cross-file registry guard to ignore type-only import edges: a rule reading comments
  from its current file is not a cross-file rule and must not be moved into a different cache
  partition merely because its host contract imports TypeScript types;
- added a private evaluator-versus-built-Oxlint corpus comparing exact rule, severity, message,
  line, byte column, UTF-8 offset, and UTF-8 length for JSX, accessibility, scope-dependent,
  Unicode, warning, and error cases;
- implemented evaluator-only Oxlint/ESLint inline-directive handling from the parser's lexical
  comment ranges without a second parse or any change to legacy `runRule`;
- differentially covered global and rule-specific disable/enable regions, mixed global/rule state,
  line and next-line directives, prefixed/bare/multiple rule IDs, descriptions, block comments,
  same-line overlap, strings/templates, UTF-8, LF, CRLF, lone CR, U+2028, and U+2029;
- retained Oxlint 1.74's measured lone-CR/U+2028/U+2029 `disable-next-line` behavior behind a
  documented compatibility hack instead of silently "correcting" the candidate backend;
- added one integrated post-processing contract from backend-accepted diagnostics through shared
  suppression/severity policy, exact and related dedupe, Reporter capture, fix groups, stable
  sorting, score-surface projection, final output, and suppression summaries;
- pinned the current severity-restamped duplicate behavior, Reporter pre-finalization view, and
  first-observed suppression-summary order so later cleanup must make any change explicitly;
- fixed the product-thinking skill's two stale `doctor-explain` references and verified every
  local skill link, tracked skill, AGENTS reference split, parity support file, and synchronized
  distributed skill;
- audited concurrency without changing the public surface: project admission and per-project
  Oxlint subprocess pools currently multiply to a hard ceiling of 128 children, and
  `--no-parallel` is serial per project rather than invocation-wide;
- concluded that one invocation-wide FIFO Oxlint spawn budget should precede a public
  `--workers N` flag, while the existing OOM split/rescue and whole-pass serial fallback must stay;
- deferred a persistent Oxlint pool because Oxlint 1.74 exposes no supported reusable lint API and
  the one-sample overhead smoke is not decision-grade.

Parity evidence:

- all 15 repository test tasks passed: core 1,843, React Doctor 2,357 with 24 skipped, plugin
  24,846 with 201 skipped, language server 67, API 19, fuzz 192 with 782 opt-in cases skipped, and
  evals 60;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with only 193 intentional fuzz-corpus warnings, and all 5,865 formatted files
  matched;
- the source-architecture guard parsed 2,133 production files with zero violations, and all four
  guard tests passed;
- the exact post-processing fixture passed inside the full core suite, including Reporter/final
  divergence, score input, fix-group identity, duplicate retention, and suppression insertion
  order;
- the evaluator parity corpus passed against the real built plugin and installed Oxlint binary;
  the prior inline-suppression TODO is now an executable differential matrix;
- all five public package contracts and the empty compatibility-delta ledger passed;
- both CLI contract tests, both build-policy tests, skill synchronization, all five published
  dependency checks, and the 781-rule generated registry passed;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- the aggregate `check` command passed when its warning-heavy output was captured to a regular log;
  direct stdout still reproduces Vite+'s known `EAGAIN` panic after printing the intentional fuzz
  warnings;
- `git diff --check`, targeted lint/format checks, and post-change `truffler` searches found no
  competing evaluator suppression index, source-position helper, changed-line filter,
  score-metadata builder, or post-processing abstraction.

#### 2026-07-27: invocation-wide subprocess budget and package-local diagnostic proof

Completed:

- generalized the existing dead-code semaphore into one private FIFO, abort-safe worker-slot
  primitive and retained the dead-code wrapper's lazy process-wide budget;
- added one invocation-scoped Oxlint subprocess budget shared by classic CLI workspace scans,
  staged and baseline scans, Ink/TUI single- and multi-project scans, `diagnose(directory)`, and
  `diagnose({ projects })`;
- preserved project-admission concurrency separately from the subprocess budget:
  `DiagnoseProjectsInput.concurrency` still controls how many projects enter the scan while the
  shared slots cap the combined Oxlint children those projects can create;
- kept the public CLI, config, telemetry, and API contracts unchanged; no `--workers` option was
  added, and single-project scans retain the same resolved worker count;
- acquire a slot only at the real spawn boundary, so binary splits, serial fallback, and OOM rescue
  all use the same cap while parsing and post-processing remain outside the queue;
- start each child timeout only after acquisition, do not advance progress for queued batches,
  remove aborted waiters without leaking capacity, and recheck both invocation and OOM-rescue
  deadlines after acquisition before allowing a child to start;
- independently reviewed the first concurrency draft and corrected two exactness hazards before
  accepting it: queued files were initially counted as started, and a deadline could initially
  expire while a batch waited for a shared slot;
- routed the module-export and barrel-classification primitives through the active resource host
  while retaining their original stat/mtime caches on the hostless production path;
- enabled virtual-project execution for `nextjs-missing-metadata` and `no-barrel-import` only after
  auditing all 55 transitively reachable modules in that rule family;
- differentially covered barrel aliases, star exports, explicit and implicit extensions, missing
  files, non-barrel negatives, ancestor metadata layouts, ordered diagnostics, and ordered parse
  failures with exactly equal real-filesystem and in-memory results;
- added a real built-Oxlint differential over a mixed React 18/Vite, React 19.1/Expo, and React
  19.2/Next workspace: default mode retains the legacy React-18 diagnostic set, while the private
  package gate adds React-19 findings only in their owning packages and keeps the React-18-only
  finding confined to the legacy package;
- extracted scan-completion policy from `runInspect` into a private pure stage covering
  lint-over-dead-code failure precedence, progress fail/stop/succeed/no-op selection, exact timing
  text, deadline-derived failure retention, and score eligibility.

Parity evidence:

- all 15 repository test tasks passed: core 1,850, React Doctor 2,357 with 24 skipped, plugin
  24,847 with 201 skipped, Language Server 67, API 19, fuzz 192 with 782 opt-in cases skipped, and
  evals 60;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with only the intentional fuzz-corpus warnings, and all 5,870 formatted files
  matched;
- the source-architecture guard parsed 2,136 production files with zero violations, and all four
  guard tests passed;
- the shared-slot tests proved FIFO admission, a two-project peak cap, exact diagnostics and order,
  release after rejection, queued abort removal, timeout start after acquisition, no queued
  progress, post-queue deadline skipping, serial fallback, and OOM rescue;
- the virtual module-export/barrel differential passed inside the full 963-file plugin suite;
- the mixed-package built-Oxlint differential passed inside the full core suite;
- all five public package contracts and the compatibility-delta ledger passed with zero active
  deltas;
- both CLI contracts, both build-policy tests, skill synchronization, and all five published
  dependency checks passed;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- the aggregate `check` command passed with its warning-heavy output captured to a regular log;
- `git diff --check`, formatting, and post-change `truffler` searches found no competing worker
  semaphore, completion-policy helper, package diagnostic harness, or resource-host export
  primitive.

#### 2026-07-27: evaluator state parity and owned planning stages

Completed:

- found and fixed one real mismatch in the still-private evaluator: it grouped diagnostics by
  requested rule order, while built Oxlint with one thread preserves requested file order and
  orders diagnostics by source span within each file;
- added an exact repeated-run, multi-file, multi-rule evaluator-versus-built-Oxlint differential
  covering rule, severity, message, file, line, column, UTF-8 byte offset, length, ordering, and
  semantic CFG state isolation between runs;
- kept crash parity explicitly unclaimed: the canonical built rules provide no comparable crash
  trigger, while an injected plugin crash has an engine-level contract rather than a per-rule
  diagnostic contract;
- audited and enabled virtual-project execution for
  `nextjs-no-use-search-params-without-suspense` after confirming its ancestor-layout, imported
  component, barrel, alias, parser, and module-resolution paths all consult the active
  `ResourceHost` before their hostless production fallbacks;
- added exact real-filesystem versus in-memory equality for direct and barrel diagnostics,
  UTF-8/CRLF locations, parse failures, ancestor-layout and in-file Suspense negatives, unrelated
  exports, missing imports, and the source-only unsupported result;
- moved the complete resolved inspect-option contract into an owned contract module, extracted the
  input/config/environment precedence policy into a pure resolver, and projected only
  cache-relevant fields through a dedicated cache-policy builder;
- preserved the old `inspect.ts` type exports as compatibility facades and characterized empty
  output directories, empty baseline refs, included-versus-ignored tags, exact defaults, false
  values, Set and array identity, and nullish cache-key behavior;
- extracted exact Linter request and mutable callback-state assembly from `runInspect` without
  moving the Linter call, Effect error recovery, timeout, reporter, service, or Reference
  boundaries;
- characterized the LintInput own-key order, explicit `false` and present-`undefined` properties,
  config/source/deadline forwarding, Set identity, progress-before-render ordering, coverage, cache
  statistics, and sidecar statistics;
- moved the pre-ES2023 tsconfig detector family out of the 2,000-line detector facade while
  retaining its original re-export, JSONC parsing, target/lib precedence, extends and references,
  fallback config order, filesystem behavior, and discovery output;
- extracted CLI per-project diff, baseline, manifest, include-order, and skip policy into a pure
  decision stage; logging, telemetry, environment reads, prompts, errors, and scan invocation stay
  in the command;
- during review, replaced a test-only type import that falsely implied
  `GitBaselineDiffPlan` belonged to the public React Doctor facade with its actual core owner.

Parity evidence:

- all 15 repository test tasks passed: core 1,857, React Doctor 2,367 with 24 skipped, plugin
  24,850 with 201 skipped, Language Server 67, API 19, ESLint plugin 4, fuzz 192 with 782 opt-in
  cases skipped, and evals 60;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with only the intentional fuzz-corpus warnings, and all 5,880 formatted files
  matched;
- the source-architecture guard parsed 2,142 production files with zero violations, and all four
  guard tests passed;
- the focused evaluator and virtual-host matrix passed 45 tests, the CLI planning and action matrix
  passed 25, and the detector plus broader discovery characterization passed 330;
- all five public package contracts and the compatibility-delta ledger passed with zero active
  deltas;
- CLI help, build policy, skill synchronization, and all five published dependency checks passed;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- the aggregate `check` command passed with warning-heavy output captured to a regular log;
- `git diff --check`, post-change `truffler`, formatting, and architecture checks found no
  duplicate planning, option-resolution, cache-policy, lint-assembly, detector, or local-module
  helper.

#### 2026-07-27: derived-state virtualization and narrower runtime owners

Completed:

- audited the derived-state cross-file path from effect state-write collection through export,
  module, alias, and parser resolution, then enabled virtual-project evaluation for
  `no-adjust-state-on-prop-change`, `no-derived-state`, `no-derived-state-effect`, and
  `no-initialize-state`;
- retained the production filesystem fallback and AST-identity cache while making every reachable
  read consult the active `ResourceHost` first;
- proved exact real-filesystem versus in-memory equality for ordered diagnostics and messages,
  CRLF and UTF-8 spans, parse failures, and negative cases; source-only evaluation remains
  explicitly unsupported for these cross-file rules;
- moved framework package ownership, display names, mobile ranking, name formatting, detection,
  and merge ranking into `project-info/detect-framework.ts`, retained the detector facade for
  compatibility, and moved internal consumers to the narrower owners;
- extracted immutable `InspectResult` projection from the CLI orchestration while keeping lazy
  construction at the same four return points, preserving rendering, telemetry, reference
  identity, optional groups, and incomplete-statistics omission;
- split the Git service's stable contracts, revision safety and diff-range policy, and output
  parsers into owned modules while leaving command execution, Effect recovery, and command order
  in the existing service;
- characterized safe and unsafe revisions, direct and symmetric ranges, empty and malformed
  endpoints, GitHub remote and viewer-permission parsing, NUL-separated output, and exact baseline
  diff ordering, deduplication, and rejection behavior;
- used symbol search before and after the moves; no competing revision policy, Git output parser,
  result projection, or framework detector was found.

Parity evidence:

- all 15 repository test tasks passed: core 1,899, React Doctor 2,370 with 24 skipped, plugin
  24,852 with 201 skipped, Language Server 67, API 19, ESLint plugin 4, fuzz 192 with 782 opt-in
  cases skipped, and evals 60;
- the focused Git, evaluator, detector, and CLI matrices passed 78, 39, 313, and 55 tests
  respectively before the full suites;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with only the intentional fuzz-corpus warnings, and all 5,889 formatted files
  matched;
- the source-architecture guard parsed 2,147 production files with zero violations, and all four
  guard tests passed;
- all five public package contracts and the compatibility-delta ledger passed with zero active
  deltas;
- CLI help, build policy, skill synchronization, and all five published dependency checks passed;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- the aggregate `check` command, `git diff --check`, formatting, and post-change symbol searches
  passed.

#### 2026-07-27: process boundary, scan settings, and Language Server adapter

Completed:

- audited `no-create-ref-in-function-component` from ref-flow analysis through recursive
  cross-file export, module, alias, and parser resolution, then enabled it for virtual-project
  evaluation without changing the hostless production branches;
- proved exact real-filesystem versus in-memory equality for ordered observed and unresolved
  diagnostics, full messages, recursive forwarding and intrinsic-ref negatives, parse failure,
  CRLF and emoji UTF-8 positions, and source-only rejection;
- moved the low-level Git process policy into a private executor while preserving the existing Git
  service, captured `ChildProcessSpawner`, argv order, cwd, environment inheritance, platform argv
  caps, concurrent stream draining, byte limits, scoped cleanup, error tags, degradation behavior,
  and trace attributes;
- directly characterized Node subprocess argv, cwd, explicit and inherited environment, stderr,
  exit status, UTF-8 byte overflow, and distinct Git versus `gh` preflight failure mapping;
- routed the Language Server's ten direct core dependents through one local adapter with exactly
  13 runtime and three type capabilities, then added a package boundary test that prevents direct
  core dependencies from spreading and snapshots the runtime capability set;
- moved `InspectInput` and `InspectHooks` into an owned neutral contract while retaining their
  `run-inspect.ts` re-exports, and extracted lint path, diff-mode, warning, scan-summary, and
  supply-chain settings into one characterized stage;
- reduced `run-inspect.ts` from 912 to 800 lines and `services/git.ts` from 811 to 643 lines without
  changing their public entry points.

Parity evidence:

- all 15 repository test tasks passed: core 1,908, React Doctor 2,370 with 24 skipped, plugin
  24,854 with 201 skipped, Language Server 69, API 19, ESLint plugin 4, fuzz 192 with 782 opt-in
  cases skipped, and evals 60;
- the direct Git boundary matrix passed four tests, the scan-settings stage passed five, the
  Language Server boundary passed two, and the virtual create-ref differential passed two before
  their full package suites;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with only the intentional fuzz-corpus warnings, and all 5,897 formatted files
  matched;
- the source-architecture guard parsed 2,151 production files with zero violations, and all four
  guard tests passed;
- all five public package contracts and the compatibility-delta ledger passed with zero active
  deltas;
- skill synchronization and all five published dependency checks passed;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- the aggregate `check` command, `git diff --check`, formatting, and post-change symbol searches
  passed.

#### 2026-07-27: owned execution lifecycles, capability adapters, and evaluator parity

Completed:

- taught the source-architecture graph to resolve workspace package roots and exported subpaths,
  including `dist` export targets mapped back to source, so package-alias cycles and backward layer
  edges are now checked alongside relative imports;
- routed API and Language Server core access through exact local adapters, then added focused React
  Doctor adapters for shared types, presentation, project/source discovery, and diagnostic
  semantics; every adapter freezes its export set and runtime identities, while existing public
  facades and declaration output remain unchanged;
- extracted dead-code execution, lint execution, environment/security/supply-chain analyzers, and
  Git/CI score-metadata collection from `runInspect`, preserving fiber start/join timing, timeout
  origins, fail-open state, Reporter order, progress behavior, callbacks, cache statistics, error
  identity, and the exact final result projection;
- reduced `run-inspect.ts` from 912 to 462 lines without changing its service entry point or
  orchestration order;
- moved the complete baseline comparison lifecycle out of the CLI orchestrator: temporary
  materialization, base scan, cache disabling, changed-line fallback, exact diagnostic delta,
  incomplete-coverage degradation, and cleanup now have one owner; `inspect.ts` is 981 lines,
  down from the original 1,313;
- switched private evaluation to the fully wrapped production rule registry, so semantic context,
  framework gates, capability gates, and package ownership share the production implementation
  instead of being reconstructed in the evaluator;
- expanded host-backed virtual-project support to 24 of the 100 cross-file rules, including
  create-ref flow, derived-state rules, browser/hydration guards, React Native raw text and shadow
  styles, Expo Image, and package-sensitive Lodash behavior;
- proved the new virtual families against the private real-filesystem evaluator, the in-memory
  evaluator, and the built Oxlint plugin, including package-local framework/version gates,
  aliases/re-exports, unresolved and malformed imports, CRLF, and UTF-8 byte locations;
- found and fixed a sidecar-cache correctness hole exposed by that parity work: a change isolated
  to an imported/re-exported server-snapshot hook now invalidates the unchanged consumer; warm
  unchanged replay still works, fresh-scan diagnostics are unchanged, traversal is cycle-bounded,
  and unrelated constant exports do not fan out;
- audited all 222 React Doctor source modules and 695 local dependency edges; every module is
  reachable from a declared build/package entry, strict unused-symbol checks pass, and no source
  deletion or reachability allowlist was justified;
- made the modular `AGENTS.md` references accurate, expanded the package map, corrected React
  Native and observability ownership, and removed the unreferenced one-off
  `scripts/convert-node-imports.mjs` migration script;
- extended `skills:check` from one distributed-tree hash comparison into an executable integrity
  gate for all 14 tracked skill manifests, relative links, and explicit local assets/scripts, and
  wired the existing parity comparator/input-validator tests into a 35-test root skill suite;
- used the symbol-search and deslop workflows before and after the moves; no competing lifecycle,
  baseline, adapter, skill-checker, dependency-collector, or architecture-resolver owner was found.

Parity evidence:

- all 15 repository test tasks passed in one logged root run: core 1,929, React Doctor 2,385 with
  24 skipped, plugin 24,868 with 201 skipped, Language Server 69, API 22, ESLint plugin 4, fuzz 192
  with 782 opt-in cases skipped, and evals 60;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with only the intentional fuzz-corpus warnings, and all 5,925 formatted files
  matched;
- the source-architecture guard parsed 2,161 production files with zero violations, and all six
  guard tests passed;
- all five public package contracts and the compatibility-delta ledger passed with zero active
  deltas;
- skill synchronization, 14-manifest skill integrity, all 35 skill/parity tests, CLI help and build
  policy, and all five published dependency checks passed;
- the JSON-report smoke produced schema version 3 in full mode;
- the installed-tarball smoke produced 201 diagnostics, matched eight entry-point contracts and 28
  CLI help contracts, and found zero forbidden runtime packages;
- the aggregate `check` command, `git diff --check`, formatting, and post-change symbol searches
  passed;
- the real baseline extraction necessarily changed bundled implementation bytes, but declarations,
  public exports, module formats, CLI help/version output, source-map validity, packed behavior,
  and exit behavior stayed fixed; `cli.js` grew 1,458 bytes (0.05%), while a 25-run version-start
  sample showed no startup regression (790.60 ms before, 782.88 ms after).

#### 2026-07-27: cache lifecycle, configuration boundary, and production-owned evaluator kernel

Completed:

- extracted the complete scan-result-cache lifecycle from `inspect.ts`: exact key construction,
  eager lookup, hit replay, project telemetry and rendering, eligibility, cold storage, final
  render/telemetry, onboarding, and bypass behavior now have one owner;
- froze the timing-sensitive cache contract, including a synchronous cold miss with no added
  microtask, hit and cold-path call order, error identity, degraded and ineligible rejection,
  whole-repository hit fields, and corrupt persisted-cache fail-open replacement;
- reduced `inspect.ts` from 981 to 887 lines; its cache-specific call site changed by +14/-108
  lines while the existing public `inspect()` facade, declarations, terminal behavior, and
  telemetry entry points stayed unchanged;
- added a React Doctor configuration capability adapter for config loading, cache clearing,
  legacy discovery, merging, validation, and the default warnings policy; the six production
  consumers now import this local boundary instead of reaching through the broad core barrel;
- froze the adapter's exact six runtime identities and expanded the existing type adapter for the
  three configuration/discovery contracts those consumers need; direct configuration capabilities
  outside the adapter are rejected by an AST boundary test;
- promoted the parser, source-location attachment, visitor dispatch, rule context, lazy scope
  analysis, lazy CFG analysis, reporting, and `ResourceHost` binding used by the private evaluator
  into production-owned internal modules; test utilities are now compatibility wrappers over that
  kernel, and evaluator runtime code no longer imports test-owned execution modules;
- preserved the mutable diagnostics-array type of the historical rule test harness after the
  integration typecheck caught that seemingly harmless readonly drift;
- enabled virtual-project execution for `nextjs-async-dynamic-api-not-awaited` and
  `nextjs-no-img-element`, bringing support to 26 of the 100 cross-file rules while retaining
  explicit source-only rejection;
- made source-project indexing enumerate through the active `ResourceHost`, allowing an in-memory
  project to model Next generated-image ownership exactly without changing the raw-filesystem
  Oxlint fallback;
- gave the async dynamic API rule a bounded nearest-manifest cache dependency collector; kept the
  image-ownership rule intentionally unbounded because a new consumer anywhere in the project can
  change an unchanged helper's verdict;
- used the symbol-search and deslop workflows around the moves; the evaluator now reuses the
  existing parser, AST utilities, scope/CFG analyzers, resource host, production registry, config
  functions, and cache policy rather than creating parallel implementations.

Parity evidence:

- all 15 repository test tasks passed in one logged root run: core 1,929, React Doctor 2,395 with
  24 skipped, plugin 24,871 with 201 skipped, Language Server 69, API 22, ESLint plugin 4, fuzz 192
  with 782 opt-in cases skipped, and evals 60;
- the new Next differential passed 39 exact real-filesystem, in-memory, and built-Oxlint cases,
  including Next 14/15 ownership, app/pages/server shapes, aliases and forwarding components,
  unresolved and malformed imports, CRLF, UTF-8 byte spans, ordered diagnostics, and repeated
  state;
- the focused cross-file rule/collector matrix passed 557 tests, sidecar cache behavior passed 13,
  scan-result-cache lifecycle and integration behavior passed 83, and the configuration boundary
  and loader matrix passed 75;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with zero errors and the 193 intentional fuzz-corpus warnings; all 5,932 formatted
  files matched;
- the source-architecture guard parsed 2,166 production files with zero violations, and all six
  guard tests passed;
- all five public package contracts and the compatibility-delta ledger passed with zero active
  deltas;
- skill synchronization, 14-manifest skill integrity, all 35 skill/parity tests, CLI help, all five
  published dependency checks, and the aggregate `check` command passed;
- the JSON-report smoke produced schema version 3 in full mode, and the installed-tarball smoke
  retained version 0.9.1, 201 diagnostics, eight entry-point contracts, 28 CLI help contracts, and
  zero forbidden runtime packages;
- the cache extraction changed the CLI bundle by 1,828 bytes (0.063%); a 25-run startup sample
  showed no regression (789.02 ms before, 777.45 ms after);
- `git diff --check`, global formatting, source architecture, post-change symbol searches, and
  production-internal dependency inspection found no competing cache lifecycle, configuration
  adapter, parser, rule executor, or evaluator dependency on test utilities.

#### 2026-07-27: render lifecycle, score boundary, and broader evaluator differential

Completed:

- extracted the complete CLI render/result/telemetry lifecycle from `inspect.ts`: cached project
  detection, result construction, surface/category projection, score-only streams, no-findings
  states, diagnostic/summary/footer rendering, projected score, scan metrics, and the canonical
  wide event now have one owner;
- kept the scan-result-cache lifecycle's callback contract intact through type-only re-exports and
  preserved its synchronous cold miss, eager lookup, store-before-render order, onboarding timing,
  error identity, and whole-repository-cache telemetry;
- reduced `inspect.ts` from 887 to 457 lines in this slice, and from 1,313 to 457 lines across the
  rewrite, while leaving option resolution, invocation-scoped Oxlint resources, orchestration,
  baseline selection, onboarding ownership, and the public `inspect()` facade in the composition
  root;
- added a seven-capability score adapter for `calculateScore`, `PERFECT_SCORE`,
  `resolveGithubActionsScoreMetadata`, the good/okay thresholds, `Score`, and the top-errors
  display count; migrated 12 production consumers and 18 runtime bindings while preserving each
  runtime identity;
- kept `SCORE_BAR_WIDTH_CHARS` out of that adapter because it is terminal layout geometry rather
  than score semantics, and added only the missing `ProgressHandle` and `WorkerSlots` contracts to
  the existing type adapter;
- expanded the evaluator differential to 46 scenarios over 51 linted files and 15 rules: 17
  generated OXC selections, eight selected `eslint-plugin-react-hooks` upstream cases, and 21
  existing regression/fuzz cases, including three real multi-file projects;
- compared exact diagnostic order, file, rule, severity, message, line, column, UTF-8 byte offset
  and length, per-file counts, a real Oxlint suppression, repeated state, and real-filesystem,
  in-memory, and built-Oxlint execution where the virtual host is required;
- pinned the evaluator's unknown-rule, unsupported-rule, and CRLF/emoji parse-failure ordering and
  shape across repeated runs without pretending Oxlint exposes an equivalent public failure
  taxonomy;
- ran an independent read-only compatibility review after the authors finished; it found no
  behavior, public-contract, cache, telemetry, ordering, or architecture defect.

Parity evidence:

- all 15 repository test tasks passed in one logged root run: core 1,929, React Doctor 2,407 with
  24 skipped, plugin 24,888 with 201 skipped, Language Server 69, API 22, ESLint plugin 4, fuzz 192
  with 782 opt-in cases skipped, and evals 60;
- the focused render/cache/inspect matrix passed 57 tests, the evaluator differential passed 56,
  the score boundary and representative score consumers passed 25, and the full plugin suite
  passed 24,888 tests;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- lint passed with zero errors and the 193 intentional fuzz-corpus warnings; all 5,937 formatted
  files matched;
- the source-architecture guard parsed 2,169 production files with zero violations, and all six
  guard tests passed;
- all five public package contracts and the compatibility-delta ledger passed with zero active
  deltas;
- skill synchronization, 14-manifest skill integrity, all 35 skill/parity tests, CLI help, build
  policy, and all five published dependency checks passed;
- the JSON-report smoke produced schema version 3 in full mode, and the installed-tarball smoke
  retained version 0.9.1, 201 diagnostics, eight entry-point contracts, 28 CLI help contracts, and
  zero forbidden runtime packages;
- formatting, `git diff --check`, post-change symbol searches, exact score-adapter identity checks,
  and the independent compatibility review passed.

Subprocess-overhead baseline:

- a local 50-sample run after ten warmups on Node 24.18.0, linux-arm64, 16 Neoverse-V2 CPUs, Oxlint
  1.74.0, one thread, and a 10,000-call-expression/158,909-byte source measured medians of 18.53 ms
  for bare Node startup, 26.14 ms for Oxlint startup, 71.55 ms for a zero-rule scan, 176.11 ms for a
  plugin-loaded zero-active-rule scan, and 224.17 ms for `react-doctor/no-eval`;
- the corresponding inferred residuals were 7.62 ms after bare Node, 45.41 ms for the no-rule scan,
  104.56 ms for the JS-plugin bridge/plugin load, and 48.06 ms for the representative rule;
- these measurements establish that fixed plugin initialization is material for a tiny scan and
  justify benchmarking a persistent-worker prototype, but they do not justify replacing Oxlint:
  the residuals are inclusive differences, the representative workload is synthetic, and the
  fixed cost's share of typical and large repository scans is not yet measured.

Product-thinking record for a possible public `evaluate` API:

- user job: rules, fuzzing, regression tests, and auto-improving workflows need to execute canonical
  React Doctor rules on supplied source without creating temporary repositories or fake manifests;
- reuse: one `evaluate({ files, rules, project, config })` virtual-project API should wrap the
  production-owned evaluator kernel, production rule registry, resource host, diagnostic schema,
  and public configuration vocabulary; a one-file request is a one-file project, and raw `runRule`,
  AST, visitor, scope, CFG, and backend settings stay private;
- telemetry: `@react-doctor/api` intentionally does not initialize Sentry, so publication must not
  add hidden phone-home telemetry merely to satisfy a product gate; if observability is approved,
  use only the existing caller-controlled OTLP path for one operation span with duration, file
  count, rule count, and failure kind, never paths, source, package/repository identity, or secrets;
- compatibility artifacts: publication is an additive product change requiring a patch Changeset,
  frozen request/result declarations, package-contract and packed-install coverage, API docs that
  distinguish `diagnose(directory)` from virtual `evaluate(...)`, and an explicit supported-rule
  matrix; it must not alter `diagnose`, CLI behavior, scoring, or the JSON-report schema;
- kill metric: keep the API private if it cannot remove most fake-project setup from eval/fuzz
  workflows, if exact supported-rule parity cannot stay at zero unexplained differences, or if
  maintaining virtual host semantics approaches the cost of maintaining a second linter;
- current decision: do not publish yet. The broader differential is meaningful evidence, but it
  still lacks Flow-only coverage, secondary labels/fixes, real open-source-hit sampling, and
  resource measurements.

#### 2026-07-27: error ownership, black-box cache parity, evaluator failures, and scale-aware overhead

Completed:

- added an exact React Doctor error capability adapter with 13 runtime identities: the legacy
  project-discovery classes, `ReactDoctorError`, error formatters/classifiers, unknown-message and
  errno helpers, and legacy throw restoration;
- migrated 11 production consumers and 23 named bindings through that adapter, including the
  existing public error facade, then froze both the adapter identities and all eight public error
  identities;
- added a real Git-backed black-box cache differential: a confirmed cold scan and confirmed
  whole-repository replay return deeply equal results and emit byte-identical `Console` events when
  nondeterministic elapsed time is fixed;
- characterized the remaining telemetry failure branch: a thrown canonical wide-event recorder
  preserves its error identity after scan metrics have already been recorded;
- added two maintained OXC `img-redundant-alt` cases under the real translator-derived custom
  settings, proving the translated option changes the intended verdict and remains exactly equal
  across the source evaluator and built Oxlint;
- added deterministic two-file rule-crash coverage: unknown and unsupported rules plus duplicate
  crashing rules serialize in exact file/rule order while later rules still emit diagnostics; the
  same input repeats with identical failures and diagnostics;
- kept that forced JavaScript getter crash evaluator-only because Oxlint settings cross a JSON
  boundary and cannot represent the getter or return the evaluator's structured failure taxonomy;
  no false cross-backend equivalence was claimed;
- expanded the deterministic differential to 48 scenarios over 53 linted files and 15 rules;
- extended the private overhead harness with validated generated 1-file/1-directory, 50-file/
  5-directory, and 250-file/25-directory workloads; each cohort runs parse-only, plugin-loaded
  zero-rule, and `no-eval` scans in fresh processes, asserts exact file/rule/diagnostic counts, and
  reports direct distributions separately from inferred residuals/shares;
- ran 20 measured samples after five warmups. The small workload measured 67.94/160.00/164.57 ms
  parse/plugin/rule medians, with a 15.6% startup proxy and 55.9% plugin increment share; medium
  measured 73.96/163.81/247.30 ms and 10.4%/36.3%; large measured
  114.01/195.87/846.44 ms and 3.0%/9.7%;
- treated `oxlint --version` only as a stable startup proxy and every subtraction/share as an
  inclusive estimate, not additive phase accounting; the generated `no-eval` trees model scaling,
  not a real repository's syntax or full rule mix;
- contracted all three already-shipped `improve-react` skill files in the installed-tarball
  manifest. The skill remains a manual packaged asset rather than being silently removed or newly
  installed by the existing `react-doctor install` command.

Decision:

- persistent workers are now the justified next backend experiment: fixed process/plugin cost is
  material for small and medium batches and falls to 12.7% combined startup-proxy plus plugin
  increment on the large synthetic workload;
- an in-process production backend is not justified. No in-process implementation was measured,
  the rule differential covers only 15 of 781 rules, and Oxlint exposes no stable boundary for
  isolated parser/rule timings;
- any worker prototype must remain behind the existing Linter service, preserve the current Oxlint
  layer for comparison/rollback, and retain batch deadlines, OOM rescue, serial fallback, crash
  isolation, cache invalidation, suppressions, ordering, and partial-failure semantics.

Still open:

- API and Language Server each have one intentional core adapter. React Doctor still has 58 source
  files with a core import: seven intentional capability/type adapters, two schema-subpath
  consumers, and 49 remaining root-barrel consumers. Runtime services, telemetry support,
  constants, JSON-report contracts, and public-facade imports still need capability ownership
  rather than another indiscriminate barrel;
- `runInspect` is now a 462-line application workflow, but it still acquires every service and owns
  project/config bootstrap, pipeline construction, progress sequencing, score invocation, and final
  assembly. CLI `inspect.ts` is now a 457-line composition root; invocation setup, orchestration,
  baseline selection, and onboarding remain intentionally visible there;
- virtual-project evaluation supports 26 of 100 cross-file rules. Remaining rules must be migrated
  by reachable primitive and given sound cache dependency collectors, not bulk-allowlisted;
- evaluator parity now has selected upstream fixtures, regression/fuzz variants, translated
  settings, suppression, repeated-state, deterministic crash serialization, and three multi-file
  projects, but still needs real open-source hits, Flow policy, fixes/secondary labels, and resource
  measurements before `evaluate` can be proposed as a documented public API;
- the Oxlint production backend remains unchanged. Repository-scale evidence now supports a
  persistent-worker prototype, but no in-process backend switch;
- `skills/improve-react` is shipped and contract-tested as a manual asset but is not installed;
  exposing or removing it remains a separate product decision;
- release documentation and automation disagree about tag signing, and the local floating `v2`
  action tag points to `v2.2.7` while `v2.2.8` exists. Moving or publishing a tag remains explicitly
  unauthorized without fresh confirmation for the exact release.

Next migration slices:

- consolidate the remaining React Doctor root-barrel consumers into a small number of real
  capability boundaries—runtime composition, error handling, constants, and telemetry support—while
  retaining `index.ts` as the public compatibility facade;
- keep the render/result/telemetry lifecycle cohesive; if `inspect.ts` needs another extraction,
  choose invocation/bootstrap or onboarding only when it owns a complete lifecycle with
  call-order, output-stream, reference-identity, and error characterization;
- keep `runInspect` as the readable application workflow unless another extraction owns a complete
  lifecycle; do not split the remaining control flow into pass-through helpers solely to reduce
  line count;
- virtualize and differentially test each remaining cross-file primitive before extending the
  allowlist, and require a matching bounded/unbounded cache dependency decision in the same slice;
- expand evaluator-versus-Oxlint parity from the focused corpus to upstream fixtures, fuzz
  variants, real open-source hits, additional cross-file rules, and comparable engine-failure
  cases;
- run the product-thinking pass before documenting or exporting the in-memory `evaluate` request;
  keep `diagnose(directory)` and the private evaluator contracts distinct until the
  supported/unsupported matrix is stable;
- keep package-local activation private until a reviewed corpus either proves zero diagnostic
  changes or records each intentional correction in the compatibility-delta ledger;
- continue extracting the scan pipeline one pure stage at a time under ordered characterization
  tests;
- run the product-thinking pass before proposing a public `--workers N` option on top of the now
  proven invocation-wide pool; retain automatic sizing, project admission, timeouts, progress,
  retries, OOM rescue, serial fallback, and `DiagnoseProjectsInput.concurrency`;
- freeze and then separately decide whether to canonicalize severity-restamped exact duplicates,
  suppression-summary ordering, and Reporter output; do not bundle those behavior changes into a
  structural move;
- make an explicit product decision before changing or removing the packaged-but-not-exposed
  `skills/improve-react` contract or the mutable-main writing-guidelines workflow;
- prototype persistent workers behind the existing Linter service and compare them against fresh
  subprocesses on the same small/medium/large cohorts; do not prototype an in-process production
  backend until both the repository-level threshold and broader parity suite justify it.

## Non-goals

- no new user-facing feature work during the rewrite;
- no package, command, flag, rule, or config renames;
- no JSON schema version bump;
- no deliberate diagnostic, score, terminal-output, or telemetry behavior change;
- no Effect replacement;
- no build-tool migration solely for aesthetics;
- no mass formatting or file movement without a capability boundary;
- no release or Action tag as part of planning.

## Historical next implementation slice

This was the next slice after the error/cache checkpoint above. The final migration state below
records its completion and supersedes the counts in this section.

Continue with one compatibility-bounded runtime-boundary slice:

1. inventory the 49 remaining React Doctor root-barrel consumers by capability and identify which
   imports are intentional public-facade use;
2. choose one cohesive runtime boundary—error handling, runtime composition, or telemetry—not a
   miscellaneous adapter;
3. freeze its exact capability set and runtime identities before moving consumers;
4. preserve the new render/result/telemetry lifecycle as one owner and avoid splitting its branches
   solely to reduce its 440-line size;
5. prototype persistent-worker savings behind the unchanged Linter service and require exact
   fresh-process parity before any production switch;
6. run the full contract, packed-install, performance, and repository gates;
7. delete any bridge superseded by the slice and repeat the symbol/dead-code audit.

In parallel, use the production-owned evaluator kernel to add upstream fixtures, fuzz variants, and
open-source hits to the evaluator-versus-Oxlint corpus, and migrate one more cross-file primitive
family with real/in-memory/built parity and a sound cache dependency collector. Do not begin the
production-backend switch or publish `evaluate` until the broader differential corpus and reviewed
overhead threshold exist.

## Final migration state — 2026-07-27

Completed:

- replaced the React Doctor package's broad Core consumption with 13 cohesive private adapters for
  configuration, diagnostic semantics, errors, presentation, primitives, product metadata,
  project discovery, reporting, runtime composition, scan caching, scoring, types, and version
  control;
- reduced production Core consumers to those 13 adapter modules and zero non-adapter consumers,
  including Core subpaths, dynamic imports, and import types; an AST guard now prevents the broad
  dependency from leaking back into CLI, Ink, telemetry, cache, or public-facade code;
- preserved public runtime identities for configuration, errors, JSON reporting, project
  discovery, diff information, and diagnostic summaries rather than replacing re-exports with
  behaviorally similar wrappers;
- retained the distinct schema-derived readonly `LiveDiagnostic` type through the reporting
  adapter without adding a runtime export or weakening it to the mutable compatibility-facade
  diagnostic type;
- gave configuration one owner for loading, discovery, merging, validation, compiler cleanup
  policy, legacy filenames, default warning policy, `defineConfig`, and its two public configuration
  contracts;
- gave runtime composition one owner for Effect services and references, scan concurrency,
  subprocess slots, OTLP, Node support, timing conversion, and AI-training environment detection;
- moved product URLs and skill identity, shared primitives, terminal presentation, reporting,
  version-control operations, and scan-cache operations into exact capability boundaries with
  export-set, runtime-identity, and bypass tests;
- split the former monolithic `AGENTS.md` into a short binding index plus six owned references for
  code conventions, architecture, Effect, observability, testing, and release safety; corrected
  the old global-type, universal-interface, global-utility, global-constant, and package-command
  rules instead of preserving contradictions;
- made guidance integrity executable: the skills check verifies reference links, canonical paths,
  declared root/workspace commands, synchronized skill trees, and the existing skill manifests;
- removed the unused `@effect/vitest` and redundant `@types/minimatch` dependencies, three
  test-only onboarding aliases, an unused architecture rule, and superseded test/parser helpers
  only after symbol, dependency, generated-registry, and focused-test evidence;
- enabled virtual-project evaluation for the complete 38-rule React Router family through the
  canonical rule list and nearest-package resource boundary, then corrected the test capability
  ladder to derive from the production thresholds rather than hand-constructing impossible version
  combinations;
- raised sound virtual-project coverage to 63 of 100 cross-file rules. The evaluator's full
  allowlist has 64 entries because `rules-of-hooks` is host-backed but is not classified as a
  cross-file rule;
- implemented a private, injectable persistent-worker prototype behind the existing batch-runner
  seam without wiring it into the production `Linter` layer;
- hardened that prototype with exact production-runner diagnostic parity, two consecutive real
  React Doctor plugin scans, response-frame isolation, rotation, crash/timeout/abort/output-limit
  replacement, idempotent shutdown, accepted-work draining, and process-exit checks;
- kept every unsupported Oxlint binding and the required process-global rule-table reset inside a
  test fixture. Production still defaults to a fresh `spawnOxlintBatchRunner`, retaining the
  current isolation and rollback behavior.

Persistent-worker measurements:

- a 20-sample alternating run after five warmups, using one worker/thread and exact output-count
  assertions, measured a 171.14 ms fresh-process median versus 8.14 ms persistent on one file
  (21.02x, 95.2% lower);
- 50 files measured 242.90 ms versus 86.86 ms (2.80x, 64.2% lower), and 250 files measured
  836.20 ms versus 621.83 ms (1.34x, 25.6% lower);
- these are steady-state reuse measurements. They exclude initialization from the persistent
  cohort and therefore do not describe cold-start latency;
- a second real plugin scan aborts unless the fixture clears Oxlint's private minified rule table,
  and execution itself requires a private minified binding. The speedup is real, but the
  integration boundary is not supportable as production architecture.

How 1:1 is enforced after this migration:

- source contracts freeze package manifests, export subpaths, runtime keys, runtime reference
  identities, public type sets, CLI help, build policy, and the zero-delta compatibility ledger;
- built contracts pack the actual workspaces, install them into an empty project, import every
  contracted entry, execute the installed CLI, and reject forbidden runtime dependencies;
- behavior contracts compare exact diagnostics, order, severity, locations and byte spans,
  suppressions, scoring inputs, JSON schema and report shape, CLI output streams and exit codes,
  error identities, telemetry no-op/privacy behavior, and cold-versus-cache result plus console
  replay;
- differential contracts run the production-owned evaluator against real files, the in-memory
  resource host, and built Oxlint for the supported corpus. Unsupported rules fail explicitly
  instead of silently returning incomplete results;
- resilience contracts retain fresh-process production behavior and cover OOM splitting, serial
  fallback, deadlines, partial failures, aborts, output ceilings, repeated state, and worker
  cleanup;
- architecture contracts parse production source and reject forbidden dependency directions and
  adapter bypasses. Guidance checks keep the human rules synchronized with those executable
  boundaries;
- only elapsed time, generated temporary roots, and Oxlint's generated `start_time` are normalized.
  A diagnostic, ordering, output, error, or schema mismatch cannot be waived as “effectively
  identical”; it needs a reviewed entry in `compatibility/approved-deltas.json`.

Final validation evidence:

- all 15 main repository test tasks passed, including 1,942 Core tests, 2,432 React Doctor tests
  with 24 skipped, and 24,895 plugin tests with 201 skipped;
- deslop-js passed 519 tests and deslop-cli passed 15;
- all 16 typecheck tasks and all nine build tasks passed;
- the aggregate repository check passed with all 5,958 files formatted and zero lint errors; its
  193 warnings are intentional adversarial fuzz-corpus inputs;
- the architecture check parsed 2,177 production files with zero violations, and all six
  architecture-guard tests passed;
- all five public package contracts, the zero-delta compatibility ledger, CLI help contracts,
  build policy, generated 781-rule registry, seven guidance documents, 14 skill manifests, 38
  skill/parity tests, and five published dependency checks passed;
- the JSON-report smoke retained schema version 3 in full mode, and the installed-tarball smoke
  retained version 0.9.1, 201 diagnostics, eight contracted entry points, 28 CLI help probes, and
  zero forbidden runtime packages;
- an independent read-only compatibility audit found no public identity, diagnostic, cache,
  output, error, telemetry, package, or production-backend defect;
- the final dead-code audit found zero unused production files in React Doctor, API, Language
  Server, or the plugin and zero unused Core exports or dependencies. Research fixtures,
  characterization hooks, and externally consumed LSP dependencies were retained deliberately.

Decision:

- the internal rewrite boundaries are in place without changing `diagnose`, `inspect`, CLI flags,
  JSON schema, scoring, terminal behavior, or the production linter backend;
- keep `evaluate` private. Its supported-rule matrix is useful for tests and fuzzing, but a public
  API still needs Flow policy, fixes and secondary labels, open-source-hit review, and resource
  budgets;
- do not replace Oxlint with the in-process evaluator and do not production-integrate the
  persistent worker while both options depend on an incomplete or unsupported host contract;
- leave legacy `ProjectInfo` compatibility fields in place even though the normalized package
  graph is now their source of truth;
- treat the remaining 37 cross-file rule families, broader evaluator corpus, and any public
  `--workers` or `evaluate` proposal as later compatibility-bounded work rather than unfinished
  structural cleanup.

Limits of the 1:1 claim:

- the contract snapshots were established during this rewrite. A release candidate should also
  compare its installed tarballs against the last published release or a pristine pre-rewrite
  build, treating additive exports separately from removals or identity changes;
- the packed smoke imports declaration-bearing entry points but does not yet compile a separate
  downstream TypeScript consumer fixture;
- local Linux checks do not replace the supported Node, Windows, macOS, and interactive-TTY CI
  matrix;
- the private evaluator differential is representative rather than exhaustive across all 781
  rules. That limitation does not affect production because the public API and `Linter` backend
  still use Oxlint.
