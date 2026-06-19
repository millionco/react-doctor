import { buildRunContext } from "./build-run-context.js";
import type { RunContext } from "./build-run-context.js";
import { buildSentryProjectContext, getSentryProjectInfo } from "./build-sentry-project-context.js";

export interface SentryScope {
  // Indexed, searchable key/values surfaced on every event. `null` entries are
  // ignored by the Sentry SDK, so absent signals (no CI, no agent) don't create
  // misleading empty tags.
  readonly tags: Record<string, string | number | boolean | null>;
  // Structured, non-indexed detail shown in the event's "Additional Data",
  // keyed by context name (`run`, and `project` once a scan has discovered it).
  readonly contexts: Record<string, Record<string, unknown>>;
}

/**
 * Projects a {@link RunContext} snapshot (plus the current run's
 * {@link getSentryProjectInfo project info}, when a scan has discovered it) into
 * the Sentry scope shape — the searchable `tags` that make crashes/transactions
 * filterable (which command, origin, CI provider, coding agent, Node major,
 * package manager, project framework/React major) plus the full `run` and
 * `project` context blocks for deep triage.
 *
 * Shared by `instrument.ts` (seeded as `initialScope` so *every* event,
 * including performance transactions, carries it) and `report-error.ts` (a
 * capture-time refresh, since runtime-only signals like `jsonMode` and the
 * scanned project are only known once a command has begun).
 */
export const buildSentryScope = (runContext: RunContext = buildRunContext()): SentryScope => {
  const tags: Record<string, string | number | boolean | null> = {
    origin: runContext.origin,
    command: runContext.command,
    ci: runContext.ci,
    ciProvider: runContext.ciProvider,
    eventName: runContext.eventName,
    viaAction: runContext.viaAction,
    codingAgent: runContext.codingAgent,
    interactive: runContext.interactive,
    terminalKind: runContext.terminalKind,
    jsonMode: runContext.jsonMode,
    debug: runContext.debug,
    invokedVia: runContext.invokedVia,
    nodeMajor: runContext.nodeMajor,
    // Low-cardinality LPT cohort dim (`cost` / `arrival`); rides every event
    // and metric so the before/after query can group on it.
    lintBatchOrdering: runContext.lintBatchOrdering,
  };
  // `runId` is intentionally NOT a tag: it's a per-run unique value and would
  // explode tag cardinality. It still rides `contexts.run` below (the full
  // run-context spread).
  const contexts: Record<string, Record<string, unknown>> = { run: { ...runContext } };

  const projectInfo = getSentryProjectInfo();
  if (projectInfo) {
    const project = buildSentryProjectContext(projectInfo);
    Object.assign(tags, project.tags);
    contexts.project = project.context;
  }

  return { tags, contexts };
};
