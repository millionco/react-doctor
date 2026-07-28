# Observability and telemetry

Use this reference before changing OTLP, Sentry, metrics, telemetry fields, privacy controls, or CLI run instrumentation. Root [AGENTS.md](../../AGENTS.md) makes these instructions binding.

## Effect tracing and OTLP

- Wrap the top-level entry of a multi-step operation in `Effect.withSpan("name", { attributes })`. See `packages/core/src/run-inspect.ts`. Attribute keys use dotted namespacing such as `inspect.directory`
- Per-service-method spans come from `Effect.fn("Service.method")`. The two compose: `runInspect` is the parent span, every `Service.method` is a child.
- `layerOtlp` in `packages/core/src/observability.ts` is wired into `inspect()` and `diagnose()`. It is a no-op unless both `REACT_DOCTOR_OTLP_ENDPOINT` and `REACT_DOCTOR_OTLP_AUTH_HEADER` are set. When enabled, it uses `Otlp.layerJson` with `FetchHttpClient.layer`

## Sentry tracer selection

Sentry tracing is CLI-only. `packages/react-doctor/src/cli/utils/apply-observability.ts` chooses the tracer backend because Effect has one `Tracer` reference. User OTLP wins and shares a `trace_id` with the Sentry root through `Tracer.externalSpan`. Otherwise, `makeSentryTracer` in `packages/react-doctor/src/cli/utils/sentry-tracer.ts` records Effect spans under the transaction from `packages/react-doctor/src/cli/utils/with-sentry-run-span.ts`. Use the native no-op tracer when neither backend is active.

`isSentryTracingEnabled()` gates this path, so it remains inert for `@react-doctor/api`, `--no-score`, tests, and `SENTRY_TRACES_SAMPLE_RATE=0`. `scripts/sentry-sourcemaps.mjs` uploads Debug ID source maps. Its `react-doctor@version` release must match the SDK release.

## Sentry scope ownership

`packages/react-doctor/src/cli/utils/build-sentry-scope.ts` projects the run snapshot and scanned project into Sentry tags and contexts. `packages/react-doctor/src/instrument.ts` and `packages/react-doctor/src/cli/utils/report-error.ts` consume it. Add new shared metadata there, not at call sites.

The `beforeLint` hook captures project info through `recordSentryProjectContext` in `packages/react-doctor/src/cli/utils/with-sentry-run-span.ts`. It stores that information for the lazy error path and sets it as root-span attributes.

## Anonymization and fail-closed behavior

Telemetry must stay anonymized. `Sentry.init` sets `sendDefaultPii: false`. `beforeSend` and `beforeSendTransaction` both run `scrubSentryEvent` in `packages/react-doctor/src/cli/utils/scrub-sentry-event.ts`:

- Strip hostname, `server_name`, device name, and the IP-bearing `user`
- Drop captured stack-frame local variables
- Run every remaining string through `packages/react-doctor/src/cli/utils/anonymize-text.ts`, which composes `scrubSensitivePaths` and `redactSensitiveText`

`buildRunContext` also scrubs `cwd` and `argv` at the source. Before adding a field to a Sentry event, confirm that it contains no username, hostname, IP, secret, or absolute path. Prefer adding it through `buildSentryScope` so the central scrub covers it. `scrubSentryEvent` returns `null` on any failure so an un-anonymized event is never sent.

## Crash references and trace linkage

`reportErrorToSentry` returns the Sentry event ID. CLI catch blocks pass it to `handleError`, which prints a reference and adds it to the prefilled GitHub issue.

Errors thrown during a scan link to the run transaction through the scope's propagation context. `withSentryRunSpan` records the trace in `packages/react-doctor/src/cli/utils/active-run-trace.ts` and clears it only after success. `reportErrorToSentry` reattaches it with `scope.setPropagationContext`.

## Sentry metrics

Sentry metrics are CLI-only. Emit anonymized counters and distributions through `packages/react-doctor/src/cli/utils/record-metric.ts`. Each operation stays inert unless `Sentry.isInitialized()`. Metrics remain independent of `tracesSampleRate`.

Metric names live in the `METRIC` map in `packages/react-doctor/src/cli/utils/constants.ts`. Use dotted, domain-grouped names. Put high-cardinality dimensions in attributes, never the name. `withRunAttributes` rebuilds `buildSentryScope().tags` for each emission so metrics use current run and project state.

Emit sites pass only metric-specific attributes. Project shape comes from `recordSentryProjectContext` through `getSentryProjectInfo()`. Per-scan metrics live in `packages/react-doctor/src/cli/utils/record-scan-metrics.ts`. Keep `rule.fired` as one counter keyed by `rule`, `plugin`, `category`, and `severity` attributes. Never create a metric name per rule.

`Sentry.init` sets `beforeSendMetric: scrubSentryMetric` in `packages/react-doctor/src/cli/utils/scrub-sentry-metric.ts`. It removes `server.address` and scrubs paths and secrets through `packages/react-doctor/src/cli/utils/anonymize-text.ts`. It returns `null` on failure. Add counters through `record-metric.ts` and the `METRIC` map, and confirm every new attribute carries no username, path, or secret.

## Canonical run wide event

The richest telemetry is one high-dimensionality wide event per scan, not a collection of narrow counters. `recordRunEvent` and `buildRunEventAttributes` live in `packages/react-doctor/src/cli/utils/build-run-event.ts`.

`packages/react-doctor/src/cli/utils/render-inspect-result.ts` records a successful scan after `recordScanMetrics`. `packages/react-doctor/src/inspect.ts` records failures at the outer span boundary and rethrows the original error. Both paths preserve the `outcome.status`, `outcome.exitCode`, and `outcome.errorTag` fields.

The root span already contains run tags and project shape. The wide event adds only the remaining fields. Namespace every attribute through `withNamespace` in `packages/react-doctor/src/cli/utils/with-namespace.ts`:

- Scan config: `scan.mode`, `scan.parallel`, `scan.workerCount`, `scan.rulesConfigured`, `scan.rulesDisabled`, `scan.ignoredTagCount`, `scan.hasCustomConfig`, and `scan.fileCount`
- Verdict: `outcome.wouldBlock`, `outcome.blocking`, `outcome.clean`, and `outcome.skippedChecks`
- Findings: `diag.total`, `diag.errors`, `diag.warnings`, `diag.affectedFiles`, `diag.distinctRules`, `diag.topRule`, and `diag.category.*`
- Score: `score.value`, `score.label`, and `score.available`
- Pass outcomes and timing: `lint.*`, `deadCode.*`, `supplyChain.*`, and `timing.*`
- CI and pull request details: `action.actorAssociation`, `action.runnerOs`, `action.comment`, `action.reviewComments`, and `action.versionPin`

Typing matters for querying. Numeric outcomes are numbers so Sentry can calculate expressions such as `p75(score.value)`. Dimensions are strings or booleans so Sentry can filter and group them. `toSpanAttributes` drops `null` so absent signals never become the string `"null"`.

Query the event in Sentry Trace Explorer on the Spans dataset. Add run-level dimensions through `packages/react-doctor/src/cli/utils/build-run-context.ts` and `packages/react-doctor/src/cli/utils/build-sentry-scope.ts`. Add per-scan outcomes to the wide event through `withNamespace`, not new counters. Keep `scan.completed`, `scan.duration`, `rule.fired`, `cli.invoked`, and `cli.error` as the trace-sampling-independent counters.

Score reachability is derivable: `!score.available && !lint.failed && !deadCode.failed && !scan.noScore`. Failed passes deliberately null the score. Score latency is the `Score.compute` child span's duration, so neither needs a dedicated field. CI detection and Action inputs live in `packages/react-doctor/src/cli/utils/is-ci-environment.ts`. `action.yml` sets the `REACT_DOCTOR_GITHUB_ACTION` marker and `REACT_DOCTOR_ACTION_*` variables. Keep all attributes free of username, path, secret, repository identity, and owner identity.

## Run ID

`packages/react-doctor/src/cli/utils/run-id.ts` creates one random `runId` per CLI process. It belongs in the Sentry `run` context and wide event, but NEVER in a tag or metric attribute. A workspace invocation shares one `runId` across projects. Do not add a plaintext or hashed repository ID to Sentry.
