import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnescapedDynamicStringInRegexp } from "./no-unescaped-dynamic-string-in-regexp.js";

interface OwnSearchWriterCase {
  name: string;
  writerBody: string;
  expectedWarning: boolean;
  prefix?: string;
}

const cases: ReadonlyArray<OwnSearchWriterCase> = [
  {
    name: "literal reset after raw write",
    writerBody: 'this.filter = value; this.filter = "fixed";',
    expectedWarning: false,
  },
  {
    name: "finally reset after raw write",
    writerBody: 'try { this.filter = value; } finally { this.filter = "fixed"; }',
    expectedWarning: false,
  },
  {
    name: "unreachable raw write",
    writerBody: "return; this.filter = value;",
    expectedWarning: false,
  },
  {
    name: "conditional return before reachable raw write",
    writerBody: "if (shouldStop) return; this.filter = value;",
    expectedWarning: true,
  },
  {
    name: "nested function return before raw write",
    writerBody: 'function readFixed() { return "fixed"; } this.filter = value;',
    expectedWarning: true,
  },
  {
    name: "erased RegExp interface retains the native constructor",
    prefix: "interface RegExp {} ",
    writerBody: "this.filter = value;",
    expectedWarning: true,
  },
  {
    name: "erased writer parameter interface retains the runtime argument",
    writerBody: "interface value {} this.filter = value;",
    expectedWarning: true,
  },
  {
    name: "runtime RegExp companion remains outside the native constructor contract",
    prefix:
      "interface RegExp {} class RegExp { constructor(...values: unknown[]) {} test(value: unknown) { return false; } } ",
    writerBody: "this.filter = value;",
    expectedWarning: false,
  },
];

describe("no-unescaped-dynamic-string-in-regexp terminal own-field writers", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const code = `${testCase.prefix ?? ""}class SearchStore {
  filter = "";
  setFilter(value, shouldStop) { ${testCase.writerBody} }
  matches(value) {
    return new RegExp(this.filter, "i").test(value);
  }
}
export default new SearchStore();
`;
      const result = runRule(noUnescapedDynamicStringInRegexp, code, {
        filename: "/synthetic/own-search-writer-control.ts",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: [] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(
        testCase.expectedWarning
          ? [
              {
                line: 5,
                column: 11,
                nodeType: "NewExpression",
                message:
                  "This builds a `RegExp` from a dynamic literal string without escaping it, so regex metacharacters in the value act as operators and over-match or throw. Escape the value with an `escapeRegExp` helper first.",
              },
            ]
          : [],
      );
    });
  }
});
