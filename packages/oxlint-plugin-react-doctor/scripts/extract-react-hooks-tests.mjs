#!/usr/bin/env node
// Extracts the upstream test fixtures from `eslint-plugin-react-hooks`'s
// RuleTester files so our `runUpstreamParity` harness can replay them
// through our native TypeScript ports of `rules-of-hooks` and
// `exhaustive-deps`.
//
// Usage:
//   node scripts/extract-react-hooks-tests.mjs <input.js> <output.json>
//
// Where <input.js> is a file from
//   facebook/react/packages/eslint-plugin-react-hooks/__tests__/
// pinned to a specific tag (e.g. eslint-plugin-react-hooks@7.1.1).
//
// What the script does:
//   1. Reads the test file as plain text.
//   2. Trims everything from the second `// For easier local testing`
//      comment forward — that block re-skips cases when not in CI; we
//      want every case the upstream test suite asserts, regardless of
//      its `skip` / `only` flag, so we drop the post-mutation code.
//   3. Stubs `require('eslint-v7')` / `require('eslint-v9')` /
//      `require('eslint-plugin-react-hooks')` to inert proxies so the
//      file evaluates without a live plugin.
//   4. Reads the `allTests` / `tests` / `testsFlow` / `testsTypescript`
//      / `testsTypescriptEslintParserV4` globals after eval, dedupes
//      by `kind:code:JSON.stringify(options)` fingerprint, and writes
//      JSON.

import * as fs from "node:fs";
import * as path from "node:path";
import vm from "node:vm";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  console.error("Usage: extract-react-hooks-tests.mjs <input.js> <output.json>");
  process.exit(2);
}

const sourceText = fs.readFileSync(inputPath, "utf8");

// The first occurrence of "// For easier local testing" is inside an
// `allTests` declaration's leading block comment. The second
// occurrence introduces the post-eval `if (!process.env.CI) { ... }`
// mutation block — which deletes `skip` flags, then strips `syntax`
// markers via `delete t.syntax`. We want neither side effect, so we
// trim everything from that second occurrence forward.
const firstIndex = sourceText.indexOf("// For easier local testing");
const truncIndex =
  firstIndex >= 0 ? sourceText.indexOf("// For easier local testing", firstIndex + 1) : -1;
const trimmed = truncIndex !== -1 ? sourceText.slice(0, truncIndex) : sourceText;

// Append a tail that exposes whichever bucket-globals exist (each
// upstream test file declares some subset of `allTests` / `tests` /
// `testsFlow` / `testsTypescript` / `testsTypescriptEslintParserV4`)
// onto a single `globalThis.__capturedAllTests` aggregate. Dedup by
// `kind:code:JSON.stringify(options)` so cross-bucket overlap doesn't
// double-count.
const wrapped = `${trimmed}
;(() => {
  const buckets = [];
  if (typeof allTests !== "undefined") buckets.push(allTests);
  if (typeof tests !== "undefined") buckets.push(tests);
  if (typeof testsFlow !== "undefined") buckets.push(testsFlow);
  if (typeof testsTypescript !== "undefined") buckets.push(testsTypescript);
  if (typeof testsTypescriptEslintParserV4 !== "undefined") buckets.push(testsTypescriptEslintParserV4);
  const combined = { valid: [], invalid: [] };
  const seen = new Set();
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const kind of ["valid", "invalid"]) {
      if (!Array.isArray(bucket[kind])) continue;
      for (const testCase of bucket[kind]) {
        const fingerprint =
          kind + ":" + (testCase && testCase.code) + ":" + JSON.stringify(testCase.options || []);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        combined[kind].push(testCase);
      }
    }
  }
  globalThis.__capturedAllTests = combined;
})();
`;

// Inert proxy that swallows every property access and call so
// `require('eslint-plugin-react-hooks')` etc. never throws while the
// test file evaluates.
const stubFunction = () => stubFunction;
const stubObject = new Proxy(stubFunction, {
  get: (_target, propertyKey) => {
    if (propertyKey === Symbol.toPrimitive) return () => "";
    if (propertyKey === "default") return stubObject;
    return stubObject;
  },
});

const sandbox = {
  console,
  process: {
    // Pretending CI=1 short-circuits the not-in-CI block (in case
    // the trim heuristic misses it on a future upstream layout
    // change). Belt + suspenders.
    env: { CI: "1" },
  },
  require: () => stubObject,
  __filename: inputPath,
  __dirname: path.dirname(inputPath),
  module: { exports: {} },
  exports: {},
  __capturedAllTests: undefined,
};
sandbox.global = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(wrapped, sandbox, { filename: inputPath });
} catch (error) {
  console.error("Eval failed:", error.message);
  process.exit(3);
}

const captured = sandbox.__capturedAllTests;
if (!captured || !Array.isArray(captured.valid)) {
  console.error("`allTests` (or equivalent) global not captured from evaluated module");
  process.exit(4);
}

// Each captured case has its `code` template literal already resolved
// to a plain string by `normalizeIndent` (defined inside the test
// file). We strip non-data fields and keep only what a parity runner
// needs.
const sanitize = (testCase) => {
  const sanitized = {};
  if (typeof testCase.code === "string") sanitized.code = testCase.code;
  if (typeof testCase.name === "string") sanitized.name = testCase.name;
  if (typeof testCase.filename === "string") sanitized.filename = testCase.filename;
  if (typeof testCase.syntax === "string") sanitized.syntax = testCase.syntax;
  if (Array.isArray(testCase.options)) sanitized.options = testCase.options;
  if (testCase.settings && typeof testCase.settings === "object") {
    sanitized.settings = testCase.settings;
  }
  if (typeof testCase.skip === "boolean" && testCase.skip) sanitized.skip = true;
  if (typeof testCase.only === "boolean" && testCase.only) sanitized.only = true;
  if (Array.isArray(testCase.errors)) {
    sanitized.errorCount = testCase.errors.length;
    sanitized.errors = testCase.errors.map((errorEntry) => {
      if (typeof errorEntry === "string") return { message: errorEntry };
      const errorOut = {};
      if (typeof errorEntry.message === "string") errorOut.message = errorEntry.message;
      if (typeof errorEntry.messageId === "string") errorOut.messageId = errorEntry.messageId;
      if (typeof errorEntry.line === "number") errorOut.line = errorEntry.line;
      if (typeof errorEntry.column === "number") errorOut.column = errorEntry.column;
      if (errorEntry.suggestions !== undefined) errorOut.suggestions = errorEntry.suggestions;
      return errorOut;
    });
  } else if (typeof testCase.errors === "number") {
    sanitized.errorCount = testCase.errors;
  }
  return sanitized;
};

const json = {
  valid: captured.valid.map(sanitize),
  invalid: captured.invalid.map(sanitize),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(json, null, 2)}\n`);
console.log(`Wrote ${outputPath} (${json.valid.length} valid, ${json.invalid.length} invalid)`);
