import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type {
  CleanedDiagnostic,
  Diagnostic,
  OxlintOutput,
  ProjectInfo,
} from "../../types/index.js";
import { ERROR_PREVIEW_LENGTH_CHARS, SOURCE_FILE_PATTERN } from "../../constants.js";
import { OxlintOutputUnparseable, ReactDoctorError } from "../../errors.js";
import { buildNoSecretsRecommendation } from "../../utils/build-no-secrets-recommendation.js";
import { appendReanimatedSharedValueHint } from "../../utils/append-reanimated-shared-value-hint.js";
import { redactSensitiveText } from "../../utils/redact-sensitive-text.js";
import { shouldSuppressLocalUseHookDiagnostic } from "./should-suppress-local-use-hook-diagnostic.js";

const FILEPATH_WITH_LOCATION_PATTERN = /\S+\.\w+:\d+:\d+[\s\S]*$/;

const REACT_COMPILER_MESSAGE = "React Compiler can't optimize this code";

const PLUGIN_CATEGORY_MAP: Record<string, string> = {
  react: "Correctness",
  "react-hooks": "Correctness",
  "react-hooks-js": "React Compiler",
  "react-doctor": "Other",
  "jsx-a11y": "Accessibility",
  effect: "State & Effects",
  // Plugins users commonly enable in their own oxlint / eslint config
  // and that react-doctor folds into the scan via `extends`. Sensible
  // defaults so adopted-rule diagnostics don't all collapse into the
  // generic "Other" bucket in the output grouping.
  eslint: "Correctness",
  oxc: "Correctness",
  typescript: "Correctness",
  unicorn: "Correctness",
  import: "Bundle Size",
  promise: "Correctness",
  n: "Correctness",
  node: "Correctness",
  vitest: "Correctness",
  jest: "Correctness",
  nextjs: "Next.js",
};

// HACK: `Object.hasOwn` guards against falling through to
// `Object.prototype` when oxlint emits a rule whose name happens to
// shadow a base Object property (`constructor`, `toString`, …). Without
// the guard the rule's help text would render as
// `function Object() { [native code] }`. Same defense applied to the
// plugin-/rule-category lookups below.
const lookupOwnString = (record: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const getRuleRecommendation = (ruleName: string, project: ProjectInfo): string | undefined => {
  if (ruleName === "no-secrets-in-client-code") {
    return buildNoSecretsRecommendation(
      project,
      reactDoctorPlugin.rules["no-secrets-in-client-code"]?.recommendation ??
        "Move secrets to server-only code",
    );
  }
  return reactDoctorPlugin.rules[ruleName]?.recommendation;
};

// Same shape as `getRuleRecommendation`, but for the diagnostic category
// (`State & Effects`, `Performance`, …) the rule rolls up under in the
// scan summary. Used by `resolveDiagnosticCategory` below and by
// `validateRuleRegistration` to assert per-rule metadata coverage.
export const getRuleCategory = (ruleName: string): string | undefined =>
  reactDoctorPlugin.rules[ruleName]?.category;

const cleanDiagnosticMessage = (
  message: unknown,
  help: unknown,
  plugin: string,
  rule: string,
  project: ProjectInfo,
): CleanedDiagnostic => {
  // `message` / `help` come from oxlint JSON that is only shape-checked at
  // the top level (`isOxlintOutput`), so coerce a non-string value to ""
  // before cleaning. This keeps the redaction path total and lets a
  // non-string `help` fall back to `getRuleRecommendation` instead of
  // becoming an empty string.
  const cleaned = resolveCleanedDiagnostic(
    typeof message === "string" ? message : "",
    typeof help === "string" ? help : "",
    plugin,
    rule,
    project,
  );
  // Final guard: a rule may echo a source fragment containing a secret
  // or PII into its message/help. Scrub it here — the single point every
  // diagnostic flows through — so it reaches neither the terminal, the
  // JSON report, nor the score API.
  return {
    message: redactSensitiveText(cleaned.message),
    help: redactSensitiveText(cleaned.help),
  };
};

const resolveCleanedDiagnostic = (
  message: string,
  help: string,
  plugin: string,
  rule: string,
  project: ProjectInfo,
): CleanedDiagnostic => {
  if (plugin === "react-hooks-js") {
    const rawMessage = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
    return {
      message: REACT_COMPILER_MESSAGE,
      help: appendReanimatedSharedValueHint(rawMessage || help, rule, project),
    };
  }
  const cleaned = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
  return {
    message: cleaned || message,
    help: help || getRuleRecommendation(rule, project) || "",
  };
};

const parseRuleCode = (code: string): { plugin: string; rule: string } => {
  const match = code.match(/^(.+)\((.+)\)$/);
  if (!match) return { plugin: "unknown", rule: code };
  return { plugin: match[1].replace(/^eslint-plugin-/, ""), rule: match[2] };
};

const resolveDiagnosticCategory = (plugin: string, rule: string): string =>
  getRuleCategory(rule) ?? lookupOwnString(PLUGIN_CATEGORY_MAP, plugin) ?? "Other";

const isOxlintOutput = (value: unknown): value is OxlintOutput => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { diagnostics?: unknown };
  return Array.isArray(candidate.diagnostics);
};

/**
 * Parses one oxlint subprocess's stdout into a flat `Diagnostic[]`.
 * Tolerates the leading-notice-line shape oxlint sometimes prints
 * before the JSON body (e.g. "No files found to lint…") by skipping
 * to the first `{`. Raises `OxlintOutputUnparseable` when the
 * stdout isn't valid JSON or doesn't carry a `diagnostics` array.
 */
export const parseOxlintOutput = (
  stdout: string,
  project: ProjectInfo,
  rootDirectory: string,
): Diagnostic[] => {
  if (!stdout) return [];

  // HACK: oxlint sometimes prepends a notice line to stdout (e.g. when
  // every input was ignored — "No files found to lint. Please check…").
  // Skip any leading non-JSON noise by jumping to the first `{` we see;
  // the remainder is the actual report. Locale- and wording-agnostic.
  const jsonStart = stdout.indexOf("{");
  const sanitizedStdout = jsonStart > 0 ? stdout.slice(jsonStart) : stdout;

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizedStdout);
  } catch {
    throw new ReactDoctorError({
      reason: new OxlintOutputUnparseable({
        preview: stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS),
      }),
    });
  }

  if (!isOxlintOutput(parsed)) {
    throw new ReactDoctorError({
      reason: new OxlintOutputUnparseable({
        preview: stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS),
      }),
    });
  }

  // HACK: oxlint reports diagnostics for every JS/TS extension it
  // scanned (`.ts`, `.tsx`, `.js`, `.jsx`). The previous filter only
  // kept `.tsx` / `.jsx` — fine when react-doctor's curated rules were
  // the only sources (they're React-specific anyway), but adopted
  // user rules like `eslint/no-debugger` or `unicorn/*` typically
  // fire on plain `.ts` / `.js` files; dropping those silently
  // erased their score impact. SOURCE_FILE_PATTERN matches the same
  // extensions we count as source files everywhere else.
  return parsed.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code &&
        SOURCE_FILE_PATTERN.test(diagnostic.filename) &&
        !shouldSuppressLocalUseHookDiagnostic(diagnostic, rootDirectory),
    )
    .map((diagnostic) => {
      const { plugin, rule } = parseRuleCode(diagnostic.code);
      const primaryLabel = diagnostic.labels[0];
      const cleaned = cleanDiagnosticMessage(
        diagnostic.message,
        diagnostic.help,
        plugin,
        rule,
        project,
      );
      return {
        filePath: diagnostic.filename.replaceAll("\\", "/"),
        plugin,
        rule,
        severity: diagnostic.severity,
        message: cleaned.message,
        help: cleaned.help,
        url: diagnostic.url,
        line: primaryLabel?.span.line ?? 0,
        column: primaryLabel?.span.column ?? 0,
        category: resolveDiagnosticCategory(plugin, rule),
      };
    });
};
