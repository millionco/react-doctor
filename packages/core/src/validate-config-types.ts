import type {
  DiagnosticSurface,
  ReactDoctorConfig,
  RuleSeverityOverride,
  SurfaceControls,
} from "./types/index.js";
import { DIAGNOSTIC_SURFACES, isDiagnosticSurface } from "./diagnostic-surface.js";
import { DIAGNOSTIC_CATEGORY_BUCKETS } from "./constants.js";
import { warnConfigIssue } from "./utils/warn-config-issue.js";

const VALID_RULE_SEVERITIES: ReadonlyArray<RuleSeverityOverride> = ["error", "warn", "off"];

// The pre-collapse category names live on in old configs. They no longer
// match any diagnostic's `category` (everything now rolls up into the five
// buckets), so a `categories` / `surfaces.*` entry keyed on one is silently
// inert. We intentionally do NOT auto-remap them — an old `"Correctness"`
// bucket is a strict subset of today's `"Bugs"`, so remapping would silence
// far more than the user asked. Instead we warn so the stale key is visible.
const KNOWN_CATEGORY_LABEL = DIAGNOSTIC_CATEGORY_BUCKETS.join(", ");

const isDiagnosticCategoryBucket = (value: string): boolean =>
  (DIAGNOSTIC_CATEGORY_BUCKETS as ReadonlyArray<string>).includes(value);

// Drops `surfaces.*.{include,exclude}Categories` entries that aren't one of
// the five buckets (e.g. a stale pre-collapse `"Bundle Size"`), warning so
// the dead entry is visible instead of silently matching nothing.
const filterKnownCategories = (fieldName: string, categories: string[]): string[] =>
  categories.filter((category) => {
    if (isDiagnosticCategoryBucket(category)) return true;
    warnConfigIssue(
      `config field "${fieldName}" lists "${category}", which is not a known category (expected one of: ${KNOWN_CATEGORY_LABEL}); ignoring the entry.`,
    );
    return false;
  });

// Boolean fields where the user might write `"true"` / `"false"` strings
// in JSON by mistake. We coerce-and-warn rather than silently accept the
// string (which JS treats as truthy and bypasses the negation path).
const BOOLEAN_FIELD_NAMES = [
  "lint",
  "deadCode",
  "verbose",
  "warnings",
  "customRulesOnly",
  "share",
  "noScore",
  "respectInlineDisables",
  "adoptExistingLintConfig",
] as const satisfies ReadonlyArray<keyof ReactDoctorConfig>;

const STRING_FIELD_NAMES = ["rootDir"] as const satisfies ReadonlyArray<keyof ReactDoctorConfig>;

const SURFACE_CONTROL_FIELD_NAMES = [
  "includeTags",
  "excludeTags",
  "includeCategories",
  "excludeCategories",
  "includeRules",
  "excludeRules",
] as const satisfies ReadonlyArray<keyof SurfaceControls>;

const SEVERITY_FIELD_NAMES = ["rules", "categories"] as const satisfies ReadonlyArray<
  keyof ReactDoctorConfig
>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatType = (value: unknown): string =>
  typeof value === "string" ? `"${value}"` : typeof value;

const isRuleSeverity = (value: unknown): value is RuleSeverityOverride =>
  typeof value === "string" && (VALID_RULE_SEVERITIES as ReadonlyArray<string>).includes(value);

const coerceMaybeBooleanString = (fieldName: string, value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "false") {
    const coerced = value === "true";
    warnConfigIssue(
      `config field "${fieldName}" is the string "${value}"; treating as boolean ${coerced}.`,
    );
    return coerced;
  }
  warnConfigIssue(
    `config field "${fieldName}" must be a boolean (got ${typeof value}); ignoring this field.`,
  );
  return undefined;
};

const validateString = (fieldName: string, value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  warnConfigIssue(
    `config field "${fieldName}" must be a string (got ${typeof value}); ignoring this field.`,
  );
  return undefined;
};

const validateStringArrayField = (fieldName: string, value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    warnConfigIssue(
      `config field "${fieldName}" must be an array of strings (got ${typeof value}); ignoring this field.`,
    );
    return undefined;
  }
  return value.filter((entry): entry is string => {
    if (typeof entry === "string") return true;
    warnConfigIssue(
      `config field "${fieldName}" contains a non-string entry (${typeof entry}); ignoring the entry.`,
    );
    return false;
  });
};

const validateSurfaceControls = (
  surface: DiagnosticSurface,
  rawControls: unknown,
): SurfaceControls | undefined => {
  if (!isPlainObject(rawControls)) {
    warnConfigIssue(
      `config field "surfaces.${surface}" must be an object (got ${typeof rawControls}); ignoring this surface.`,
    );
    return undefined;
  }
  const validatedSurfaceControls: SurfaceControls = {};
  for (const fieldName of SURFACE_CONTROL_FIELD_NAMES) {
    if (rawControls[fieldName] === undefined) continue;
    const qualifiedName = `surfaces.${surface}.${fieldName}`;
    const result = validateStringArrayField(qualifiedName, rawControls[fieldName]);
    if (result === undefined) continue;
    validatedSurfaceControls[fieldName] =
      fieldName === "includeCategories" || fieldName === "excludeCategories"
        ? filterKnownCategories(qualifiedName, result)
        : result;
  }
  return validatedSurfaceControls;
};

const validateSurfacesField = (
  rawSurfaces: unknown,
): Partial<Record<DiagnosticSurface, SurfaceControls>> | undefined => {
  if (!isPlainObject(rawSurfaces)) {
    warnConfigIssue(
      `config field "surfaces" must be an object (got ${typeof rawSurfaces}); ignoring this field.`,
    );
    return undefined;
  }
  const validated: Partial<Record<DiagnosticSurface, SurfaceControls>> = {};
  for (const [key, value] of Object.entries(rawSurfaces)) {
    if (!isDiagnosticSurface(key)) {
      warnConfigIssue(
        `config field "surfaces.${key}" is not a known surface (expected one of: ${DIAGNOSTIC_SURFACES.join(", ")}); ignoring.`,
      );
      continue;
    }
    const controls = validateSurfaceControls(key, value);
    if (controls !== undefined) validated[key] = controls;
  }
  return validated;
};

// Validates one of the top-level severity maps (`rules` / `categories`) —
// the ESLint / oxlint-shaped severity surface. Returns the validated map,
// dropping invalid entries with a warning. When `keysAreCategories` is set
// (the `categories` field) each key must be one of the five buckets; a
// stale pre-collapse name (e.g. `"Correctness"`) is dropped with a warning
// rather than silently doing nothing.
const validateSeverityMap = (
  fieldName: string,
  rawMap: unknown,
  keysAreCategories = false,
): Record<string, RuleSeverityOverride> | undefined => {
  if (!isPlainObject(rawMap)) {
    warnConfigIssue(
      `config field "${fieldName}" must be an object (got ${typeof rawMap}); ignoring this field.`,
    );
    return undefined;
  }
  const validated: Record<string, RuleSeverityOverride> = {};
  for (const [key, value] of Object.entries(rawMap)) {
    if (key.length === 0) {
      warnConfigIssue(`config field "${fieldName}" has an empty key; ignoring the entry.`);
      continue;
    }
    if (keysAreCategories && !isDiagnosticCategoryBucket(key)) {
      warnConfigIssue(
        `config field "${fieldName}.${key}" is not a known category (expected one of: ${KNOWN_CATEGORY_LABEL}); ignoring the entry.`,
      );
      continue;
    }
    if (!isRuleSeverity(value)) {
      warnConfigIssue(
        `config field "${fieldName}.${key}" must be one of: ${VALID_RULE_SEVERITIES.join(", ")} (got ${formatType(value)}); ignoring the entry.`,
      );
      continue;
    }
    validated[key] = value;
  }
  return validated;
};

// Applies a validator to one config field: undefined skips, an `undefined`
// return strips the field, anything else replaces it. Keeps the main
// loop free of the repeating "if (raw === undefined) continue; result =
// validator(...); if (result === undefined) delete; else assign" dance.
const applyFieldValidator = <Key extends keyof ReactDoctorConfig>(
  config: ReactDoctorConfig,
  validated: ReactDoctorConfig,
  fieldName: Key,
  validator: (value: unknown) => ReactDoctorConfig[Key] | undefined,
): void => {
  const raw = (config as Record<string, unknown>)[fieldName];
  if (raw === undefined) return;
  const result = validator(raw);
  if (result === undefined) {
    delete (validated as Record<string, unknown>)[fieldName];
  } else {
    (validated as Record<string, unknown>)[fieldName] = result;
  }
};

// Returns a config with boolean fields coerced from common JSON-typing
// mistakes (string "true"/"false") and other invalid types stripped.
// Non-validated fields pass through untouched — consumers still do their
// own runtime checks for those.
export const validateConfigTypes = (config: ReactDoctorConfig): ReactDoctorConfig => {
  const validated: ReactDoctorConfig = { ...config };
  for (const fieldName of BOOLEAN_FIELD_NAMES) {
    applyFieldValidator(config, validated, fieldName, (value) =>
      coerceMaybeBooleanString(fieldName, value),
    );
  }
  for (const fieldName of STRING_FIELD_NAMES) {
    applyFieldValidator(config, validated, fieldName, (value) => validateString(fieldName, value));
  }
  applyFieldValidator(config, validated, "surfaces", validateSurfacesField);
  for (const fieldName of SEVERITY_FIELD_NAMES) {
    applyFieldValidator(config, validated, fieldName, (value) =>
      validateSeverityMap(fieldName, value, fieldName === "categories"),
    );
  }
  applyFieldValidator(config, validated, "plugins", (value) =>
    validateStringArrayField("plugins", value),
  );
  return validated;
};
