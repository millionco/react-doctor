import * as fs from "node:fs";
import * as path from "node:path";
import { TRIAGE_STATE_JSON_INDENT_SPACES, TRIAGE_STATE_SCHEMA_VERSION } from "./constants.js";

export interface TriageState {
  readonly schemaVersion: number;
  readonly lastScanAt: string | null;
  readonly prompted: readonly string[];
  readonly skipped: readonly string[];
  readonly disabled: readonly string[];
}

export interface TriageStateUpdate {
  readonly prompted?: readonly string[];
  readonly skipped?: readonly string[];
  readonly disabled?: readonly string[];
}

const TRIAGE_STATE_FILE_NAME = "triage-state.json";
export const emptyTriageState = (): TriageState => ({
  schemaVersion: TRIAGE_STATE_SCHEMA_VERSION,
  lastScanAt: null,
  prompted: [],
  skipped: [],
  disabled: [],
});

export const getTriageStatePath = (outputDirectory: string): string =>
  path.join(outputDirectory, TRIAGE_STATE_FILE_NAME);

const collectStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];

const readStateField = (value: unknown, fieldName: keyof TriageState): unknown => {
  if (value === null || typeof value !== "object") return undefined;
  if (fieldName === "schemaVersion" && "schemaVersion" in value) return value.schemaVersion;
  if (fieldName === "lastScanAt" && "lastScanAt" in value) return value.lastScanAt;
  if (fieldName === "prompted" && "prompted" in value) return value.prompted;
  if (fieldName === "skipped" && "skipped" in value) return value.skipped;
  if (fieldName === "disabled" && "disabled" in value) return value.disabled;
  return undefined;
};

export const readTriageState = (outputDirectory: string): TriageState => {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(getTriageStatePath(outputDirectory), "utf8"),
    );
    const schemaVersion = readStateField(parsed, "schemaVersion");
    if (schemaVersion !== TRIAGE_STATE_SCHEMA_VERSION) return emptyTriageState();
    const lastScanAt = readStateField(parsed, "lastScanAt");
    return {
      schemaVersion: TRIAGE_STATE_SCHEMA_VERSION,
      lastScanAt: typeof lastScanAt === "string" ? lastScanAt : null,
      prompted: collectStringArray(readStateField(parsed, "prompted")),
      skipped: collectStringArray(readStateField(parsed, "skipped")),
      disabled: collectStringArray(readStateField(parsed, "disabled")),
    };
  } catch {
    return emptyTriageState();
  }
};

const mergeRuleKeys = (
  existingRuleKeys: readonly string[],
  addedRuleKeys: readonly string[] | undefined,
): string[] => [...new Set([...existingRuleKeys, ...(addedRuleKeys ?? [])])].sort();

export const updateTriageState = (state: TriageState, update: TriageStateUpdate): TriageState => ({
  schemaVersion: TRIAGE_STATE_SCHEMA_VERSION,
  lastScanAt: new Date().toISOString(),
  prompted: mergeRuleKeys(state.prompted, update.prompted),
  skipped: mergeRuleKeys(state.skipped, update.skipped),
  disabled: mergeRuleKeys(state.disabled, update.disabled),
});

export const pruneTriageState = (
  state: TriageState,
  activeRuleKeys: ReadonlySet<string>,
): TriageState => ({
  ...state,
  prompted: state.prompted.filter((ruleKey) => activeRuleKeys.has(ruleKey)),
  skipped: state.skipped.filter((ruleKey) => activeRuleKeys.has(ruleKey)),
  disabled: state.disabled.filter((ruleKey) => activeRuleKeys.has(ruleKey)),
});

export const writeTriageState = (outputDirectory: string, state: TriageState): void => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    getTriageStatePath(outputDirectory),
    `${JSON.stringify(state, null, TRIAGE_STATE_JSON_INDENT_SPACES)}\n`,
  );
};
