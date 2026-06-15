import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";

describe("no-json-parse-stringify-clone", () => {
  it("flags `JSON.parse(JSON.stringify(obj))`", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = JSON.parse(JSON.stringify(state));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("structuredClone");
  });

  it("flags the clone even when a replacer/reviver is passed", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = JSON.parse(JSON.stringify(state, replacer), reviver);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `JSON.stringify(JSON.parse(str))` (normalization, not a clone)", () => {
    const result = runRule(noJsonParseStringifyClone, `const s = JSON.stringify(JSON.parse(raw));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain `JSON.parse(str)`", () => {
    const result = runRule(noJsonParseStringifyClone, `const data = JSON.parse(raw);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `JSON.parse` of a non-stringify call", () => {
    const result = runRule(noJsonParseStringifyClone, `const data = JSON.parse(readFile());`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-JSON object with parse/stringify methods", () => {
    const result = runRule(noJsonParseStringifyClone, `const x = YAML.parse(YAML.stringify(obj));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag passing `JSON.stringify` as a reference (not called)", () => {
    const result = runRule(noJsonParseStringifyClone, `const fn = JSON.parse(JSON.stringify);`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
