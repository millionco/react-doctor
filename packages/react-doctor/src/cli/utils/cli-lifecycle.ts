import * as path from "node:path";
import {
  type CliState,
  type CliStateOptions,
  type EventOutcome,
  type MigrationRecord,
  type ProjectScopeState,
  type ScopeState,
  INITIAL_LIFECYCLE_VERSION,
  readCliState,
  updateCliState,
} from "./cli-state-store.js";
import { hashProjectRoot } from "./hash-project-root.js";
import { nowIso } from "./now-iso.js";

// The CLI growth/lifecycle framework. Three primitives, all backed by the one
// per-user state file and all idempotent + fail-safe:
//
//   • Gate      — fire something ONCE per scope (onboarding, a CTA, a one-time
//                 prompt). Carries an outcome and a version.
//   • Migration — run a code/config change ONCE per scope, tracked so it never
//                 re-runs (action + config updates).
//   • Invalidate — bump a gate's or migration's `version` and it re-fires /
//                 re-runs, so a reworded CTA or a new migration shows again.
//
// Scope is "global" (once per machine/user) or "project" (once per repo).

export type LifecycleScope = "global" | "project";

// A `scope`-bearing thing the scope helpers below can resolve. Both `Gate` and
// `Migration` satisfy it.
interface Scoped {
  readonly scope: LifecycleScope;
}

export interface Gate extends Scoped {
  // Stable storage key for this gate's event record.
  readonly id: string;
  // Defaults to 1. Bump to invalidate every recorded firing so the gate opens
  // again — the mechanism for re-showing a reworked CTA or a new offer.
  readonly version?: number;
  // When the store can't be read, is the gate treated as pending (fire)?
  // Defaults to false: suppress, so a broken store never nags where the answer
  // can't be remembered. Persistent hints that should re-appear set this true.
  readonly fireWhenUnknown?: boolean;
}

export interface GateTarget {
  // Required for `scope: "project"` gates; ignored for global ones.
  readonly projectRoot?: string;
  // Recorded alongside the firing (e.g. a CTA's accepted/declined answer).
  readonly outcome?: EventOutcome;
}

export interface Migration extends Scoped {
  readonly id: string;
  // Defaults to 1. Bump to re-run the migration (a newer transform supersedes
  // an older recorded run).
  readonly version?: number;
  // The transform. Must be idempotent: the framework guarantees run-once when
  // it can persist, but a read-only store can't record, so a re-run must be
  // safe. Returns whether it actually applied — a `false` (nothing to do, or
  // failed) is NOT recorded, so it stays pending and retries next time.
  readonly run: (context: MigrationRunContext) => boolean | Promise<boolean>;
}

export interface MigrationRunContext {
  readonly projectRoot?: string;
}

export interface MigrationResult {
  readonly id: string;
  // Whether `run` was invoked this pass (false when already recorded).
  readonly ran: boolean;
  // Whether the migration is now considered applied (recorded or already was).
  readonly applied: boolean;
}

const versionOf = (item: { readonly version?: number }): number =>
  item.version ?? INITIAL_LIFECYCLE_VERSION;

const selectScope = (
  state: CliState,
  scoped: Scoped,
  projectRoot?: string,
): ScopeState | undefined =>
  scoped.scope === "global"
    ? state.global
    : projectRoot === undefined
      ? undefined
      : state.projects?.[hashProjectRoot(projectRoot)];

// Applies `updateScopeState` to the right scope, creating the per-project
// record (with its resolved root) on first write. The single place scope
// resolution + creation lives, shared by every gate/migration writer.
const updateScope = (
  state: CliState,
  scoped: Scoped,
  projectRoot: string | undefined,
  updateScopeState: (scope: ScopeState) => ScopeState,
): CliState => {
  if (scoped.scope === "global") {
    return { ...state, global: updateScopeState(state.global ?? {}) };
  }
  if (projectRoot === undefined) return state;
  const projectKey = hashProjectRoot(projectRoot);
  const existing = state.projects?.[projectKey];
  const base: ProjectScopeState = existing ?? { rootDirectory: path.resolve(projectRoot) };
  return {
    ...state,
    projects: {
      ...state.projects,
      [projectKey]: { ...base, ...updateScopeState(base) },
    },
  };
};

const omitKey = <Value>(
  record: Record<string, Value> | undefined,
  key: string,
): Record<string, Value> => {
  const { [key]: _removed, ...rest } = record ?? {};
  return rest;
};

// === Gates ===

// True when the gate has not fired at its current version — never recorded, or
// recorded at an older version that an invalidation (version bump) supersedes.
export const isGatePending = (
  gate: Gate,
  target: GateTarget = {},
  options: CliStateOptions = {},
): boolean => {
  // A project gate with no target can't be recorded (`recordGate` is a no-op),
  // so it must not read as pending — otherwise it would fire on every call.
  if (gate.scope === "project" && target.projectRoot === undefined) return false;
  return readCliState(
    (state) => {
      const record = selectScope(state, gate, target.projectRoot)?.events?.[gate.id];
      return !record || record.version < versionOf(gate);
    },
    gate.fireWhenUnknown ?? false,
    options,
  );
};

// The outcome recorded for the gate's latest firing, or null if never fired.
export const readGateOutcome = (
  gate: Gate,
  target: GateTarget = {},
  options: CliStateOptions = {},
): EventOutcome | null =>
  readCliState(
    (state) => selectScope(state, gate, target.projectRoot)?.events?.[gate.id]?.outcome ?? null,
    null,
    options,
  );

// Records that the gate fired (optionally with an outcome). Returns whether it
// persisted. Callers wanting a stable first-fire timestamp guard with
// `isGatePending` before calling.
export const recordGate = (
  gate: Gate,
  target: GateTarget = {},
  options: CliStateOptions = {},
): boolean =>
  updateCliState(
    (state) =>
      updateScope(state, gate, target.projectRoot, (scope) => ({
        ...scope,
        events: {
          ...scope.events,
          [gate.id]: {
            firedAt: nowIso(),
            version: versionOf(gate),
            ...(target.outcome ? { outcome: target.outcome } : {}),
          },
        },
      })),
    options,
  );

// Invalidation/admin: clear a gate's recorded firing so it becomes pending
// again. (Day-to-day invalidation is a `version` bump; this is the explicit
// reset for tests and one-off resets.)
export const clearGate = (
  gate: Gate,
  target: GateTarget = {},
  options: CliStateOptions = {},
): boolean =>
  updateCliState(
    (state) =>
      updateScope(state, gate, target.projectRoot, (scope) => ({
        ...scope,
        events: omitKey(scope.events, gate.id),
      })),
    options,
  );

// === Migrations ===

export const isMigrationPending = (
  migration: Migration,
  target: MigrationRunContext = {},
  options: CliStateOptions = {},
): boolean => {
  // Symmetric with `isGatePending`: a project migration with no target can't be
  // recorded, so it's never pending.
  if (migration.scope === "project" && target.projectRoot === undefined) return false;
  return readCliState(
    (state) => {
      const record = selectScope(state, migration, target.projectRoot)?.migrations?.[migration.id];
      return !record || record.version < versionOf(migration);
    },
    false,
    options,
  );
};

const recordMigration = (
  migration: Migration,
  projectRoot: string | undefined,
  record: MigrationRecord,
  options: CliStateOptions,
): boolean =>
  updateCliState(
    (state) =>
      updateScope(state, migration, projectRoot, (scope) => ({
        ...scope,
        migrations: { ...scope.migrations, [migration.id]: record },
      })),
    options,
  );

// Runs every pending migration in order, records the ones that apply, and
// returns a per-migration report. A migration that throws or returns false is
// left unrecorded so it retries on the next run.
export const runMigrations = async (
  migrations: ReadonlyArray<Migration>,
  target: MigrationRunContext = {},
  options: CliStateOptions = {},
): Promise<MigrationResult[]> => {
  const results: MigrationResult[] = [];
  for (const migration of migrations) {
    if (!isMigrationPending(migration, target, options)) {
      results.push({ id: migration.id, ran: false, applied: true });
      continue;
    }
    let applied = false;
    try {
      applied = await migration.run({ projectRoot: target.projectRoot });
    } catch {
      applied = false;
    }
    if (applied) {
      recordMigration(
        migration,
        target.projectRoot,
        { ranAt: nowIso(), version: versionOf(migration) },
        options,
      );
    }
    results.push({ id: migration.id, ran: true, applied });
  }
  return results;
};
