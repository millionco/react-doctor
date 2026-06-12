import * as path from "node:path";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type {
  CleanedDiagnostic,
  Diagnostic,
  DiagnosticRelatedLocation,
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
const LEADING_SEVERITY_LABEL_PATTERN = /^(?:Error|Warning):\s*/;
const TRAILING_PERIOD_PATTERN = /\.$/;

// Adopted `react-hooks-js` (React Compiler) diagnostics have no
// react-doctor `title`, so they'd otherwise render their bare
// `react-hooks-js/todo` id. Give them a human headline & an impact-first
// message that carries the first line of the compiler's bail-out reason;
// the reason's remaining lines stay in `help`, so renderers that print
// message + help never repeat the same sentence back-to-back.
const REACT_COMPILER_TITLE = "React Compiler can't optimize this";
// The compiler's `todo` rule fires on syntax it doesn't handle yet —
// an unsupported-syntax bail-out, not an optimization miss in the
// user's code, so it gets its own headline.
const REACT_COMPILER_TODO_TITLE = "React Compiler doesn't support this syntax";
const REACT_COMPILER_IMPACT =
  "This component misses React Compiler's automatic memoization & re-renders more than it should";
const REACT_COMPILER_ACTION = "Rewrite the flagged code so the compiler can optimize it.";
const REACT_COMPILER_GENERIC_MESSAGE = `${REACT_COMPILER_IMPACT}. ${REACT_COMPILER_ACTION}`;

const buildReactCompilerMessage = (reasonSummary: string): string => {
  const normalizedSummary = reasonSummary.replace(TRAILING_PERIOD_PATTERN, "");
  if (!normalizedSummary) return REACT_COMPILER_GENERIC_MESSAGE;
  return `${REACT_COMPILER_IMPACT}: ${normalizedSummary}. ${REACT_COMPILER_ACTION}`;
};

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
const resolveDiagnosticTitle = (plugin: string, rule: string): string | undefined => {
  if (plugin !== "react-hooks-js") return getRuleTitle(rule);
  return rule === "todo" ? REACT_COMPILER_TODO_TITLE : REACT_COMPILER_TITLE;
};

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
    const bailoutReason = message
      .replace(FILEPATH_WITH_LOCATION_PATTERN, "")
      .trim()
      .replace(LEADING_SEVERITY_LABEL_PATTERN, "")
      .trim();
    // `todo` bail-out reasons are compiler-internal work notes (e.g.
    // "(BuildHIR::lowerExpression) Handle TaggedTemplateExpression
    // expressions") — not user-facing impact copy — so they stay in
    // `help` and the message keeps its generic wording.
    if (rule === "todo") {
      return {
        message: REACT_COMPILER_GENERIC_MESSAGE,
        help: appendReanimatedSharedValueHint(bailoutReason || help, rule, project),
      };
    }
    // The reason's first line is its summary; any remaining lines are the
    // compiler's elaboration. The summary moves into the primary message
    // and only the elaboration stays in `help`.
    const [reasonSummary = "", ...reasonDetailLines] = bailoutReason.split("\n");
    const reasonDetail = reasonDetailLines.join("\n").trim();
    return {
      message: buildReactCompilerMessage(reasonSummary.trim()),
      help: appendReanimatedSharedValueHint(reasonDetail || help, rule, project),
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

/**
 * Maps oxlint's non-primary labels (`labels[1..]`) into related source
 * locations. Editors surface these as a diagnostic's
 * `relatedInformation`; non-editor consumers ignore the field. Labels
 * with empty text still carry a useful jump target, so they're kept
 * with a neutral message.
 */
const buildRelatedLocations = (
  labels: OxlintOutput["diagnostics"][number]["labels"],
  filePath: string,
): DiagnosticRelatedLocation[] => {
  if (labels.length <= 1) return [];
  const related: DiagnosticRelatedLocation[] = [];
  for (let labelIndex = 1; labelIndex < labels.length; labelIndex++) {
    const label = labels[labelIndex];
    if (!label?.span) continue;
    related.push({
      filePath,
      line: label.span.line ?? 0,
      column: label.span.column ?? 0,
      offset: label.span.offset,
      length: label.span.length,
      message: label.label ?? "",
    });
  }
  return related;
};

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
  // scanned (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`). The previous filter only
  // kept `.tsx` / `.jsx` — fine when react-doctor's curated rules were
  // the only sources (they're React-specific anyway), but adopted
  // user rules like `eslint/no-debugger` or `unicorn/*` typically
  // fire on plain `.ts` / `.js` files; dropping those silently
  // erased their score impact. `isLintableSourceFile` matches the same
  // extensions we count as source files everywhere else, and also drops
  // generated bundler output (`*.iife.js`, `*.umd.js`, `*.global.js`,
  // `*.min.js`, plus the `.mjs` variants) so a stray bundle that slipped past file discovery can't
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
      const normalizedFilePath = diagnostic.filename.replaceAll("\\", "/");
      // Carry oxlint's UTF-8 byte span through to the Diagnostic so
      // editor integrations (LSP) can resolve a precise range from the
      // in-memory document. `line` / `column` stay the source of truth
      // for everything else; offset / length are additive.
      const primarySpan = primaryLabel?.span;
      const relatedLocations = buildRelatedLocations(diagnostic.labels, normalizedFilePath);
      return {
        filePath: normalizedFilePath,
        plugin,
        rule,
        severity: diagnostic.severity,
        title: resolveDiagnosticTitle(plugin, rule),
        message: cleaned.message,
        help: cleaned.help,
        url: diagnostic.url,
        line: primarySpan?.line ?? 0,
        column: primarySpan?.column ?? 0,
        ...(primarySpan ? { offset: primarySpan.offset, length: primarySpan.length } : {}),
        category: resolveDiagnosticCategory(plugin, rule),
        ...(relatedLocations.length > 0 ? { relatedLocations } : {}),
      };
    });
};
