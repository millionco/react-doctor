// ESLint/oxlint-compatible plugin that surfaces react-compiler-oxc's lint
// diagnostics as the `react-hooks-js/*` rules, replacing eslint-plugin-react-hooks
// (which bundled babel-plugin-react-compiler). Each rule runs the native compiler
// once per file (cached across the 16 rules) and reports the diagnostics whose
// rule matches, formatting the message exactly as eslint-plugin-react-hooks does
// (printErrorSummary + @babel/code-frame), so output stays 1:1.

const { codeFrameColumns } = require("@babel/code-frame");
const native = require("./index.js");

// printErrorSummary's heading buckets (CompilerError.ts). Keyed by the
// ErrorCategory wire tag the native binding emits.
const HEADING_BY_CATEGORY = {
  CapitalizedCalls: "Error",
  Config: "Error",
  EffectDerivationsOfState: "Error",
  EffectSetState: "Error",
  ErrorBoundaries: "Error",
  FBT: "Error",
  Gating: "Error",
  Globals: "Error",
  Hooks: "Error",
  Immutability: "Error",
  Purity: "Error",
  Refs: "Error",
  RenderSetState: "Error",
  StaticComponents: "Error",
  Suppression: "Error",
  Syntax: "Error",
  UseMemo: "Error",
  VoidUseMemo: "Error",
  MemoDependencies: "Error",
  EffectExhaustiveDependencies: "Error",
  EffectDependencies: "Compilation Skipped",
  IncompatibleLibrary: "Compilation Skipped",
  PreserveManualMemo: "Compilation Skipped",
  UnsupportedSyntax: "Compilation Skipped",
  Invariant: "Invariant",
  Todo: "Todo",
};

// The 16 rules eslint-plugin-react-hooks ships from the React Compiler. Exposed
// here under the same names so the `react-hooks-js/<name>` keys stay identical.
const RULE_NAMES = [
  "set-state-in-render",
  "immutability",
  "refs",
  "purity",
  "hooks",
  "set-state-in-effect",
  "globals",
  "error-boundaries",
  "preserve-manual-memoization",
  "unsupported-syntax",
  "component-hook-factories",
  "static-components",
  "use-memo",
  "void-use-memo",
  "incompatible-library",
  "todo",
];

// CODEFRAME_* constants from CompilerError.ts.
const CODEFRAME_LINES_ABOVE = 2;
const CODEFRAME_LINES_BELOW = 3;
const CODEFRAME_MAX_LINES = 10;
const CODEFRAME_ABBREVIATED_SOURCE_LINES = 5;

const printErrorSummary = (category, reason) =>
  `${HEADING_BY_CATEGORY[category] ?? "Error"}: ${reason}`;

const printCodeFrame = (source, loc, message) => {
  const printed = codeFrameColumns(
    source,
    {
      start: { line: loc.start.line, column: loc.start.column + 1 },
      end: { line: loc.end.line, column: loc.end.column + 1 },
    },
    {
      message,
      linesAbove: CODEFRAME_LINES_ABOVE,
      linesBelow: CODEFRAME_LINES_BELOW,
    },
  );
  const lines = printed.split(/\r?\n/);
  if (loc.end.line - loc.start.line < CODEFRAME_MAX_LINES) {
    return printed;
  }
  const pipeIndex = lines[0].indexOf("|");
  return [
    ...lines.slice(0, CODEFRAME_LINES_ABOVE + CODEFRAME_ABBREVIATED_SOURCE_LINES),
    " ".repeat(pipeIndex) + "\u2026",
    ...lines.slice(-(CODEFRAME_LINES_BELOW + CODEFRAME_ABBREVIATED_SOURCE_LINES)),
  ].join("\n");
};

// Port of CompilerDiagnostic.printErrorMessage(source, { eslint: true }). The
// native loc carries no filename, so the optional `filename:line:column` line is
// omitted (matching `loc.filename == null` upstream).
const printErrorMessage = (source, event) => {
  const buffer = [printErrorSummary(event.category, event.reason)];
  if (event.description != null) {
    buffer.push("\n\n", `${event.description}.`);
  }
  for (const detail of event.details) {
    if (detail.loc == null) continue;
    let codeFrame;
    try {
      codeFrame = printCodeFrame(source, detail.loc, detail.message ?? "");
    } catch {
      codeFrame = detail.message ?? "";
    }
    buffer.push("\n\n");
    buffer.push(codeFrame);
  }
  return buffer.join("");
};

const primaryLocation = (event) => {
  const first = event.details.find((detail) => detail.loc != null);
  return first ? first.loc : null;
};

// One compiler run per file, shared across all 16 rules (mirrors
// eslint-plugin-react-hooks' RunCacheEntry). Keyed by the SourceCode object,
// which is stable for the duration of a file's lint pass.
const resultCache = new WeakMap();

const getResults = (sourceCode, filename) => {
  const cached = resultCache.get(sourceCode);
  if (cached !== undefined) return cached;
  const events = native.lint(sourceCode.text, filename);
  resultCache.set(sourceCode, events);
  return events;
};

const makeRule = (ruleName) => ({
  meta: {
    type: "problem",
    fixable: "code",
    hasSuggestions: true,
    schema: [{ type: "object", additionalProperties: true }],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const filename = context.filename ?? context.getFilename();
    const events = getResults(sourceCode, filename);
    for (const event of events) {
      if (event.ruleName !== ruleName) continue;
      const loc = primaryLocation(event);
      if (loc == null) continue;
      context.report({ message: printErrorMessage(sourceCode.text, event), loc });
    }
    return {};
  },
});

module.exports = {
  meta: { name: "react-hooks-js" },
  rules: Object.fromEntries(RULE_NAMES.map((name) => [name, makeRule(name)])),
};
