import * as fs from "node:fs";
import * as path from "node:path";
import url from "node:url";
import { describe, it, expect } from "vite-plus/test";
import { runRule } from "../../../../test-utils/run-rule.js";
import type { Rule } from "../../../utils/rule.js";

interface UpstreamCase {
  code: string;
  name?: string;
  filename?: string;
  syntax?: string;
  options?: ReadonlyArray<unknown>;
  settings?: Readonly<Record<string, unknown>>;
  errorCount?: number;
  errors?: ReadonlyArray<unknown>;
  skip?: boolean;
  only?: boolean;
}

interface UpstreamFixture {
  valid: ReadonlyArray<UpstreamCase>;
  invalid: ReadonlyArray<UpstreamCase>;
}

interface UpstreamSkipEntry {
  // 0-based index into the relevant `valid` / `invalid` array.
  index: number;
  // Optional human-readable reason — surfaced when the test is reported.
  reason?: string;
}

export interface UpstreamParityOptions {
  // `valid` cases the rule incorrectly flags (false positives).
  validSkips?: ReadonlyArray<number | UpstreamSkipEntry>;
  // `invalid` cases the rule reports a different count for (false
  // negatives or over-reports).
  invalidSkips?: ReadonlyArray<number | UpstreamSkipEntry>;
  // Optional translator that turns upstream `options[0]` (the
  // first-arg config eslint-plugin-react-hooks accepts) into the
  // `settings: { "react-doctor": { <ruleKey>: …} }` shape our rule
  // reads.
  translateOptions?: (
    upstreamOptions: ReadonlyArray<unknown> | undefined,
  ) => Readonly<Record<string, unknown>> | undefined;
}

const fixturesDirectory = path.dirname(url.fileURLToPath(import.meta.url));

// Upper bound on the number of characters of code to embed in an
// `it("…")` label. Beyond this we replace the tail with an ellipsis so
// the test reporter stays readable on long fixtures.
const MAX_LABEL_LENGTH_CHARS = 70;

const loadFixture = (slug: string): UpstreamFixture =>
  JSON.parse(fs.readFileSync(path.join(fixturesDirectory, `${slug}.json`), "utf8"));

const truncate = (text: string, maxLength = MAX_LABEL_LENGTH_CHARS): string => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= maxLength ? oneLine : `${oneLine.slice(0, maxLength - 1)}…`;
};

const skipIndices = (
  entries: ReadonlyArray<number | UpstreamSkipEntry> | undefined,
): ReadonlySet<number> => {
  if (!entries) return new Set();
  const indices = new Set<number>();
  for (const entry of entries) {
    if (typeof entry === "number") indices.add(entry);
    else indices.add(entry.index);
  }
  return indices;
};

const hasUnsupportedFlowSyntax = (testCase: UpstreamCase): boolean => {
  if (testCase.syntax === "flow") return true;
  if (/^\s*(?:component|hook)\s+[A-Za-z_$]/m.test(testCase.code)) return true;
  return /\(\s*\{[^)]*\}\s*:\s*[^)]+\)/.test(testCase.code);
};

const normalizeUnsupportedFlowSyntax = (code: string): string =>
  code
    .replace(/^(\s*)component\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm, "$1function $2(")
    .replace(/^(\s*)hook\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm, "$1function $2(")
    .replace(/\(\s*(\{[^)]*\})\s*:\s*([^)]+)\)/g, "($1 as $2)");

const hasTsGenericArrowAmbiguity = (code: string): boolean =>
  /<\s*[A-Z][A-Za-z0-9_$]*(?:\s+extends\s+[^>]*)?>\s*\(/.test(code);

// Drives the upstream `eslint-plugin-react-hooks` test fixtures through
// our ported rule via the `runRule` harness. Each upstream case becomes
// one `it(...)` that asserts diagnostic counts match upstream's.
export const runUpstreamParity = (
  fixtureSlug: string,
  rule: Rule,
  options: UpstreamParityOptions = {},
): void => {
  const fixture = loadFixture(fixtureSlug);
  const validSkipSet = skipIndices(options.validSkips);
  const invalidSkipSet = skipIndices(options.invalidSkips);

  const registerCase = (
    kind: "valid" | "invalid",
    testCase: UpstreamCase,
    caseIndex: number,
    skipSet: ReadonlySet<number>,
  ): void => {
    const isSkipped = Boolean(testCase.skip) || skipSet.has(caseIndex);
    const itFunction = isSkipped ? it.skip : it;
    const expectedDiagnostics = kind === "valid" ? 0 : (testCase.errorCount ?? 1);
    const label = `${kind} #${caseIndex} ${testCase.name ?? truncate(testCase.code)}`;
    itFunction(label, () => {
      const settings =
        options.translateOptions !== undefined
          ? (options.translateOptions(testCase.options) ?? testCase.settings)
          : testCase.settings;
      const code = hasUnsupportedFlowSyntax(testCase)
        ? normalizeUnsupportedFlowSyntax(testCase.code)
        : testCase.code;
      const forceJsx = !hasTsGenericArrowAmbiguity(code);
      const filename = testCase.filename ?? (forceJsx ? "Component.tsx" : "Component.ts");
      const result = runRule(rule, code, { filename, settings, forceJsx });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedDiagnostics);
    });
  };

  describe(`${fixtureSlug} upstream parity (eslint-plugin-react-hooks)`, () => {
    fixture.valid.forEach((testCase, caseIndex) =>
      registerCase("valid", testCase, caseIndex, validSkipSet),
    );
    fixture.invalid.forEach((testCase, caseIndex) =>
      registerCase("invalid", testCase, caseIndex, invalidSkipSet),
    );
  });
};
