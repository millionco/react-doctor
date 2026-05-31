import path from "node:path";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type {
  CleanedDiagnostic,
  Diagnostic,
  OxlintOutput,
  ProjectInfo,
} from "../../types/index.js";
import { ERROR_PREVIEW_LENGTH_CHARS } from "../../constants.js";
import { isLintableSourceFile } from "../../utils/is-lintable-source-file.js";
import { isMinifiedSource } from "../../utils/is-minified-source.js";
import { OxlintOutputUnparseable, ReactDoctorError } from "../../errors.js";
import { buildNoSecretsRecommendation } from "../../utils/build-no-secrets-recommendation.js";
import { appendReanimatedSharedValueHint } from "../../utils/append-reanimated-shared-value-hint.js";
import { redactSensitiveText } from "../../utils/redact-sensitive-text.js";
import { shouldSuppressLocalUseHookDiagnostic } from "./should-suppress-local-use-hook-diagnostic.js";

const FILEPATH_WITH_LOCATION_PATTERN = /\S+\.\w+:\d+:\d+[\s\S]*$/;

// Adopted `react-hooks-js` (React Compiler) diagnostics have no
// react-doctor `title`, so they'd otherwise render their bare
// `react-hooks-js/todo` id. Give them a human headline & an impact-first
// message; the specific bail-out reason stays in `help`.
const REACT_COMPILER_TITLE = "React Compiler can't optimize this";
const REACT_COMPILER_MESSAGE =
  "This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the compiler can optimize it.";

// Adopted third-party plugins (not in the react-doctor registry) → the
// clear user-facing bucket their diagnostics roll up under. Mirrors the
// five buckets the codegen collapses react-doctor rules into (see
// `CATEGORY_BUCKET` in `generate-rule-registry.mjs`): Security, Bugs,
// Performance, Accessibility, Maintainability.
const PLUGIN_CATEGORY_MAP: Record<string, string> = {
  react: "Bugs",
  "react-hooks": "Bugs",
  // React Compiler "can't optimize" diagnostics are an optimization miss,
  // not a correctness bug.
  "react-hooks-js": "Performance",
  "react-doctor": "Bugs",
  "jsx-a11y": "Accessibility",
  effect: "Bugs",
  eslint: "Bugs",
  oxc: "Bugs",
  typescript: "Bugs",
  unicorn: "Bugs",
  import: "Performance",
  promise: "Bugs",
  n: "Bugs",
  node: "Bugs",
  vitest: "Bugs",
  jest: "Bugs",
  nextjs: "Bugs",
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

// Short human headline for a rule (e.g. "Array index used as a key").
// Only react-doctor rules carry one; adopted third-party rules return
// undefined and renderers fall back to the `plugin/rule` id.
const getRuleTitle = (ruleName: string): string | undefined =>
  reactDoctorPlugin.rules[ruleName]?.title;

// react-doctor rules carry their own `title`; adopted React Compiler
// diagnostics get a fixed human headline instead of their bare id.
const resolveDiagnosticTitle = (plugin: string, rule: string): string | undefined =>
  plugin === "react-hooks-js" ? REACT_COMPILER_TITLE : getRuleTitle(rule);

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
  getRuleCategory(rule) ?? lookupOwnString(PLUGIN_CATEGORY_MAP, plugin) ?? "Bugs";

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
  // erased their score impact. `isLintableSourceFile` matches the same
  // extensions we count as source files everywhere else, and also drops
  // generated bundler output (`*.iife.js`, `*.umd.js`, `*.global.js`,
  // `*.min.js`) so a stray bundle that slipped past file discovery can't
  // pollute the report.
  // The content sniff additionally drops minified files that carry an
  // ordinary extension (e.g. a one-line `public/inject.js`) — these reach
  // the parser in diff/staged mode (which scans changed files directly,
  // bypassing whole-tree discovery) or when they're too small for the
  // discovery-time size gate. Cached so each file is read at most once.
  const minifiedFileCache = new Map<string, boolean>();
  const isMinifiedDiagnosticFile = (filename: string): boolean => {
    const absolutePath = path.isAbsolute(filename)
      ? filename
      : path.resolve(rootDirectory || ".", filename);
    const cached = minifiedFileCache.get(absolutePath);
    if (cached !== undefined) return cached;
    const minified = isMinifiedSource(absolutePath);
    minifiedFileCache.set(absolutePath, minified);
    return minified;
  };

  return parsed.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code &&
        isLintableSourceFile(diagnostic.filename) &&
        !isMinifiedDiagnosticFile(diagnostic.filename) &&
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
        title: resolveDiagnosticTitle(plugin, rule),
        message: cleaned.message,
        help: cleaned.help,
        url: diagnostic.url,
        line: primaryLabel?.span.line ?? 0,
        column: primaryLabel?.span.column ?? 0,
        category: resolveDiagnosticCategory(plugin, rule),
      };
    });
};
