import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnsafeJsonParse } from "./no-unsafe-json-parse.js";

interface LocalJsonReviewCase {
  name: string;
  code: string;
  expected: number;
}

const reviewCases: LocalJsonReviewCase[] = [
  {
    name: "unused ambient carrier",
    code: "declare const globalThis: any; const parsed = JSON.parse(raw); const value = parsed.value;",
    expected: 1,
  },
  {
    name: "real local carrier survives interface",
    code: "const globalThis = { JSON: { parse: replacement } }; interface globalThis {} globalThis.JSON.parse = replacement; const parsed = JSON.parse(raw); const value = parsed.value;",
    expected: 1,
  },
  {
    name: "unrelated global carrier read",
    code: "void globalThis.location; const parsed = JSON.parse(raw); const value = parsed.value;",
    expected: 1,
  },
  {
    name: "merged condition write declines",
    code: "const read = (enabled, raw) => { interface enabled {} enabled = false; const parsed = enabled ? JSON.parse(raw) : {}; const value = parsed.value; };",
    expected: 0,
  },
  {
    name: "merged result capture declines",
    code: "const read = (raw) => { const parsed = JSON.parse(raw); const value = parsed.value; const later = () => { interface parsed {} return parsed.value; }; };",
    expected: 0,
  },
  {
    name: "merged result guard preserved",
    code: "const read = (raw) => { const parsed = JSON.parse(raw); if (parsed) { interface parsed {} consume(parsed.value); } };",
    expected: 0,
  },
  {
    name: "ambient carrier mutation",
    code: "declare const globalThis: any; globalThis.JSON.parse = replacement; const parsed = JSON.parse(raw); const value = parsed.value;",
    expected: 0,
  },
  {
    name: "merged result binding",
    code: "const parsed = JSON.parse(raw); interface parsed {} const value = parsed.value;",
    expected: 0,
  },
  {
    name: "nested merged result read",
    code: "const read = (raw) => { const parsed = JSON.parse(raw); const value = parsed.value; { interface parsed {} consume(parsed.value); } };",
    expected: 1,
  },
  {
    name: "merged conditional parameter",
    code: "const read = (enabled, raw) => { interface enabled {} const parsed = enabled ? JSON.parse(raw) : {}; const value = parsed.value; };",
    expected: 1,
  },
  {
    name: "nested merged result property write",
    code: "const parsed = JSON.parse(raw); const value = parsed.value; { interface parsed {} parsed.value = safe; }",
    expected: 0,
  },
  {
    name: "global object eval rewrite",
    code: 'globalThis.eval("JSON.parse = () => ({ value: 1 })"); const parsed = JSON.parse(raw); const value = parsed.value;',
    expected: 0,
  },
  {
    name: "aliased global object eval rewrite",
    code: 'const evaluate = globalThis.eval; evaluate("JSON.parse = () => ({ value: 1 })"); const parsed = JSON.parse(raw); const value = parsed.value;',
    expected: 0,
  },
];

describe("no-unsafe-json-parse bounded review", () => {
  for (const source of reviewCases) {
    it(source.name, () => {
      const result = runRule(noUnsafeJsonParse, source.code, { filename: "src/view.tsx" });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(source.expected);
    });
  }
});
