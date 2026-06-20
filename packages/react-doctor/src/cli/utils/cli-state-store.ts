import Conf from "conf";
import { REACT_DOCTOR_CONFIG_PROJECT_NAME } from "./constants.js";
import { nowIso } from "./now-iso.js";

// The single per-user state file behind every onboarding / growth / migration
// concern. This module is the ONLY place that opens the `Conf` store, owns the
// on-disk schema, holds the read/write fail-safes, applies schema migrations,
// and resolves the (test-overridable) config directory. Feature code never
// touches this directly — it goes through the lifecycle framework
// (`cli-lifecycle.ts`), which expresses everything as gates and migrations.

// Overrides the config directory so tests (and locked-down sandboxes) point
// persisted state at a throwaway dir. An explicit `options.cwd` still wins;
// this is the ambient fallback so code deep in a flow can't accidentally write
// to the real user store.
export const CONFIG_DIR_ENV_VAR = "REACT_DOCTOR_CONFIG_DIR";

// Bumped whenever the on-disk shape changes; `migrateCliState` upgrades older
// files to this version in place. v1 was the original flat layout
// (`onboardedAt` + `ciPrompts` / `actionUpgrades` / `projects.setupPrompt`);
// v2 is the unified scope/event model below.
export const CLI_STATE_SCHEMA_VERSION = 2;

// The version a gate/migration carries when it doesn't declare one — its first,
// un-invalidated incarnation. Bumping a gate/migration above this re-fires it.
export const INITIAL_LIFECYCLE_VERSION = 1;

// Well-known lifecycle event ids (stable storage keys). They live here because
// `migrateCliState` maps the legacy keys onto them; the gates that own each one
// re-import the constant so the id is written in exactly one place.
//
// Every onboarding/growth surface in the CLI, at a glance. Gates fire once per
// scope ("global" = per machine, "project" = per repo); migrations run once per
// repo. Bump a `version` to re-fire/re-run one. Keep this table in sync when you
// add a surface.
//
//   surface               kind       scope    id / migration id   wired in
//   ────────────────────  ─────────  ───────  ──────────────────  ────────────────────────
//   first-run onboarding  gate       global   onboarding          onboarding-state.ts
//   "add to CI?" pitch    gate       project  ci-pitch            ci-prompt-decision.ts
//   @v1 → @v2 offer       gate       project  action-upgrade-v2   action-upgrade-prompt.ts
//   agent install hint    gate       project  setup-hint          prompt-install-setup.ts
//   config json → ts      migration  project  config-json-to-ts   cli-migrations.ts
export const ONBOARDING_EVENT = "onboarding";
export const CI_PITCH_EVENT = "ci-pitch";
export const ACTION_UPGRADE_EVENT = "action-upgrade-v2";
export const SETUP_HINT_EVENT = "setup-hint";

// Well-known preference ids (stable storage keys). Unlike gates, a preference
// is a free-form remembered value the user can change every run, read back as a
// default rather than fired once. Kept here so the whole persisted-key surface
// stays greppable in one place.
//
//   surface                       scope    id                  wired in
//   ────────────────────────────  ───────  ──────────────────  ──────────────────────────────
//   post-scan handoff target      global   handoff-target      handoff-target-preference.ts
export const HANDOFF_TARGET_PREFERENCE_ID = "handoff-target";

export type EventOutcome = "seen" | "accepted" | "declined";

// One firing of a gate (an onboarding reveal, a CTA, a once-per-repo prompt).
export interface EventRecord {
  readonly firedAt: string;
  // The gate's `version` at fire time; a higher gate version re-opens the gate.
  readonly version: number;
  readonly outcome?: EventOutcome;
}

// One successful run of a migration (a code/config update applied to the repo).
export interface MigrationRecord {
  readonly ranAt: string;
  // The migration's `version` at run time; a higher version re-runs it.
  readonly version: number;
}

export interface ScopeState {
  readonly events?: Record<string, EventRecord>;
  readonly migrations?: Record<string, MigrationRecord>;
  // Free-form remembered values, keyed by a well-known preference id. Additive
  // and optional: pre-existing state files simply lack it (no migration needed),
  // and an absent key reads back as "no preference yet".
  readonly preferences?: Record<string, string>;
}

// Per-repo scope, keyed by hashed root under `projects`. Carries the resolved
// root for debuggability (never an absolute path elsewhere in the file).
export interface ProjectScopeState extends ScopeState {
  readonly rootDirectory: string;
  // Legacy pre-v2 field, read once by `migrateCliState` then dropped.
  readonly setupPrompt?: false;
}

export interface CliState {
  readonly schemaVersion?: number;
  readonly global?: ScopeState;
  readonly projects?: Record<string, ProjectScopeState>;
  // Legacy pre-v2 top-level keys, read once by `migrateCliState` then dropped.
  readonly onboardedAt?: string;
  readonly ciPrompts?: Record<string, LegacyDecisionRecord>;
  readonly actionUpgrades?: Record<string, LegacyDecisionRecord>;
}

interface LegacyDecisionRecord {
  readonly rootDirectory?: string;
  readonly outcome?: EventOutcome;
  readonly at?: string;
}

export interface CliStateOptions {
  // Overrides the config dir; tests point this at a temp dir. Falls back to
  // `CONFIG_DIR_ENV_VAR`, then to `Conf`'s default per-user config location.
  readonly cwd?: string;
}

// Folds one legacy per-project decision map (`ciPrompts` / `actionUpgrades`)
// into the unified per-project event records, preserving the recorded outcome
// and timestamp so no repo gets re-prompted after the upgrade.
const foldLegacyDecisions = (
  projects: Record<string, ProjectScopeState>,
  legacy: Record<string, LegacyDecisionRecord> | undefined,
  eventId: string,
): void => {
  for (const [hash, record] of Object.entries(legacy ?? {})) {
    const existing = projects[hash] ?? { rootDirectory: record.rootDirectory ?? "" };
    projects[hash] = {
      ...existing,
      events: {
        ...existing.events,
        [eventId]: {
          firedAt: record.at ?? nowIso(),
          version: INITIAL_LIFECYCLE_VERSION,
          ...(record.outcome ? { outcome: record.outcome } : {}),
        },
      },
    };
  }
};

// Upgrades a state object read from disk to `CLI_STATE_SCHEMA_VERSION`. Pure
// and idempotent: a current-version object is returned untouched, and the fold
// preserves every recorded answer so the upgrade never re-nags or re-runs.
export const migrateCliState = (state: CliState): CliState => {
  if (state.schemaVersion === CLI_STATE_SCHEMA_VERSION) return state;

  const projects: Record<string, ProjectScopeState> = {};

  // Legacy per-project setup-prompt opt-out → a recorded (declined) setup-hint.
  for (const [hash, record] of Object.entries(state.projects ?? {})) {
    const carried: ProjectScopeState = {
      rootDirectory: record.rootDirectory,
      ...(record.events ? { events: record.events } : {}),
      ...(record.migrations ? { migrations: record.migrations } : {}),
    };
    projects[hash] =
      record.setupPrompt === false
        ? {
            ...carried,
            events: {
              ...carried.events,
              [SETUP_HINT_EVENT]: {
                firedAt: nowIso(),
                version: INITIAL_LIFECYCLE_VERSION,
                outcome: "declined",
              },
            },
          }
        : carried;
  }

  foldLegacyDecisions(projects, state.ciPrompts, CI_PITCH_EVENT);
  foldLegacyDecisions(projects, state.actionUpgrades, ACTION_UPGRADE_EVENT);

  const global: ScopeState =
    typeof state.onboardedAt === "string"
      ? {
          events: {
            [ONBOARDING_EVENT]: { firedAt: state.onboardedAt, version: INITIAL_LIFECYCLE_VERSION },
          },
        }
      : {};

  return { schemaVersion: CLI_STATE_SCHEMA_VERSION, global, projects };
};

const resolveConfigDir = (options: CliStateOptions): string | undefined =>
  options.cwd ?? (process.env[CONFIG_DIR_ENV_VAR] || undefined);

const openStore = (options: CliStateOptions = {}): Conf<CliState> =>
  new Conf<CliState>({
    projectName: REACT_DOCTOR_CONFIG_PROJECT_NAME,
    cwd: resolveConfigDir(options),
  });

// Opens the store and upgrades it to the current schema in place (persisting
// the upgrade once, best-effort) so every reader sees the canonical shape.
const openMigratedStore = (options: CliStateOptions): Conf<CliState> => {
  const store = openStore(options);
  if (store.store.schemaVersion !== CLI_STATE_SCHEMA_VERSION) {
    store.store = migrateCliState(store.store);
  }
  return store;
};

export const getCliStatePath = (options: CliStateOptions = {}): string => openStore(options).path;

// Reads a projection of the state, degrading to `fallback` when the config dir
// is unreadable (EPERM / EROFS in locked-down CI and sandboxes) — an
// environment limitation, never a react-doctor bug.
export const readCliState = <Value>(
  select: (state: CliState) => Value,
  fallback: Value,
  options: CliStateOptions = {},
): Value => {
  try {
    return select(openMigratedStore(options).store);
  } catch {
    return fallback;
  }
};

// Applies an update to the whole state object and persists it. Returns whether
// it landed; a read-only config dir just means the choice isn't remembered.
export const updateCliState = (
  update: (state: CliState) => CliState,
  options: CliStateOptions = {},
): boolean => {
  try {
    const store = openMigratedStore(options);
    store.store = update(store.store);
    return true;
  } catch {
    return false;
  }
};
