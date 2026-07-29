import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

interface CompatibilityDelta {
  readonly id: string;
  readonly owner: string;
  readonly scope: string;
  readonly rationale: string;
  readonly observedDifference: string;
  readonly expiryCondition: string;
  readonly removalIssue: string;
}

interface CompatibilityDeltaLedger {
  readonly schemaVersion: number;
  readonly deltas: ReadonlyArray<CompatibilityDelta>;
}

const COMPATIBILITY_DELTA_SCHEMA_VERSION = 1;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const LEDGER_PATH = path.join(SCRIPT_DIRECTORY, "approved-deltas.json");

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isCompatibilityDelta = (value: unknown): value is CompatibilityDelta => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  return (
    "id" in value &&
    isNonEmptyString(value.id) &&
    "owner" in value &&
    isNonEmptyString(value.owner) &&
    "scope" in value &&
    isNonEmptyString(value.scope) &&
    "rationale" in value &&
    isNonEmptyString(value.rationale) &&
    "observedDifference" in value &&
    isNonEmptyString(value.observedDifference) &&
    "expiryCondition" in value &&
    isNonEmptyString(value.expiryCondition) &&
    "removalIssue" in value &&
    isNonEmptyString(value.removalIssue)
  );
};

const isCompatibilityDeltaLedger = (value: unknown): value is CompatibilityDeltaLedger => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (!("schemaVersion" in value) || value.schemaVersion !== COMPATIBILITY_DELTA_SCHEMA_VERSION) {
    return false;
  }
  if (!("deltas" in value) || !Array.isArray(value.deltas)) return false;
  return value.deltas.every(isCompatibilityDelta);
};

if (!fs.existsSync(LEDGER_PATH)) {
  console.error(`Missing ${path.relative(REPOSITORY_ROOT, LEDGER_PATH)}.`);
  process.exit(1);
}

const ledger: unknown = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
if (!isCompatibilityDeltaLedger(ledger)) {
  console.error("Invalid compatibility delta ledger.");
  process.exit(1);
}

const duplicateIdentifiers = ledger.deltas
  .map(({ id }) => id)
  .filter((identifier, index, identifiers) => identifiers.indexOf(identifier) !== index);
if (duplicateIdentifiers.length > 0) {
  console.error(
    `Duplicate compatibility delta IDs: ${[...new Set(duplicateIdentifiers)].join(", ")}`,
  );
  process.exit(1);
}

console.log(`Compatibility delta ledger is valid with ${ledger.deltas.length} active deltas.`);
