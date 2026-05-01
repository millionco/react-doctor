import type { ReactDoctorConfig } from "../types.js";

// Boolean fields where the user might write `"true"` / `"false"` strings
// in JSON by mistake. We coerce-and-warn rather than silently accept the
// string (which JS treats as truthy and bypasses the negation path).
const BOOLEAN_FIELD_NAMES = [
  "lint",
  "deadCode",
  "verbose",
  "customRulesOnly",
  "share",
  "respectInlineDisables",
] as const satisfies ReadonlyArray<keyof ReactDoctorConfig>;

// HACK: write to stderr directly so the warning is visible even in
// `--json` mode (where the logger is silenced to keep stdout a single
// valid JSON document). Same pattern as `coerceDiffValue` in cli.ts.
const warnConfigField = (message: string): void => {
  process.stderr.write(`[react-doctor] ${message}\n`);
};

const coerceMaybeBooleanString = (fieldName: string, value: unknown): boolean | undefined => {
  if (typeof value === "boolean" || value === undefined) return value as boolean | undefined;
  if (value === "true") {
    warnConfigField(`config field "${fieldName}" is the string "true"; treating as boolean true.`);
    return true;
  }
  if (value === "false") {
    warnConfigField(
      `config field "${fieldName}" is the string "false"; treating as boolean false.`,
    );
    return false;
  }
  warnConfigField(
    `config field "${fieldName}" must be a boolean (got ${typeof value}); ignoring this field.`,
  );
  return undefined;
};

// Returns a config with boolean fields coerced from common JSON-typing
// mistakes (string "true"/"false") and other invalid types stripped.
// Non-boolean fields pass through untouched — the consumer still does
// its own runtime checks for those.
export const validateConfigTypes = (config: ReactDoctorConfig): ReactDoctorConfig => {
  const validated: ReactDoctorConfig = { ...config };
  for (const fieldName of BOOLEAN_FIELD_NAMES) {
    const original = (config as Record<string, unknown>)[fieldName];
    if (original === undefined) continue;
    const coerced = coerceMaybeBooleanString(fieldName, original);
    if (coerced === undefined) {
      delete (validated as Record<string, unknown>)[fieldName];
    } else {
      (validated as Record<string, unknown>)[fieldName] = coerced;
    }
  }
  return validated;
};
