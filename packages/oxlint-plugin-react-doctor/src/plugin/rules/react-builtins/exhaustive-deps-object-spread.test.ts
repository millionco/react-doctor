import { describe, expect, it } from "vite-plus/test";
import { parseSync } from "oxc-parser";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

interface SpreadCaseOptions {
  readonly producer?: string;
  readonly dependencies?: string;
  readonly setup?: string;
  readonly expression?: string;
  readonly declaration?: string;
  readonly prelude?: string;
}

const runSpread = ({
  producer = "const createRecord = (value) => ({ value });",
  dependencies = "record.value",
  setup = "",
  expression = "({ ...record })",
  declaration = "const record = createRecord(value, other, flag);",
  prelude = "",
}: SpreadCaseOptions = {}) =>
  runRule(
    exhaustiveDeps,
    `
      import { useMemo } from "react";
      ${prelude}
      ${producer}
      export const Panel = ({ value, other, flag }) => {
        ${declaration}
        ${setup}
        return useMemo(() => ${expression}, [${dependencies}]);
      };
    `,
  );

describe("exhaustive-deps local object spread fields", () => {
  it("declines script-global function replacement", () => {
    const source = `
      function createRecord(value) { return { value }; }
      globalThis.createRecord = (value, other) => ({ value, other });
      function Panel({ value, other }) {
        const record = createRecord(value, other);
        return useMemo(() => ({ ...record }), [record.value]);
      }
    `;
    const parsed = parseSync("panel.js", source, { astType: "ts", sourceType: "script" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.program.sourceType).toBe("script");
    if (!isAstNode(parsed.program)) throw new Error("Expected a parsed program");
    const result = runRuleOnParsedFixture(exhaustiveDeps, source, {
      program: parsed.program,
      errors: [],
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("`record`");
  });

  it.each([
    ["concise arrow", {}],
    [
      "multi-statement declaration",
      {
        producer:
          "function createRecord(value) { const selected = value; return { value: selected }; }",
      },
    ],
    [
      "block arrow",
      {
        producer:
          "const createRecord = (value) => { const selected = value; return { value: selected }; };",
      },
    ],
    [
      "all own fields",
      {
        producer: "const createRecord = (value, other, flag) => ({ value, other, flag });",
        dependencies: "record.value, record.other, record.flag",
      },
    ],
    [
      "nested callback returns",
      {
        producer:
          "function createRecord(value) { const nested = () => { return null; }; return { value }; }",
      },
    ],
    [
      "opaque field values",
      {
        producer:
          "function createRecord(value) { const selected = readValue(value); return { value: selected }; }",
      },
    ],
    ["copies of own fields", { setup: "const copied = { ...record }; consume(copied);" }],
    [
      "unrelated eval property",
      { prelude: "const metadata = { eval: 'label' }; consume(metadata.eval);" },
    ],
    [
      "transparent type wrappers",
      {
        declaration: "const record = (createRecord(value) as { value: unknown });",
        expression: "({ ...(record as { value: unknown }) })",
      },
    ],
    ["empty spread field set", { producer: "const createRecord = () => ({});", dependencies: "" }],
  ])("accepts %s", (_description, options: SpreadCaseOptions) => {
    expect(runSpread(options)).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("reports the omitted own field", () => {
    const result = runSpread({
      producer: "const createRecord = (value, other) => ({ value, other });",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`record.other`");
  });

  it("keeps runtime eval behind an erased ambient declaration conservative", () => {
    const result = runSpread({
      prelude: "declare const eval: (source: string) => unknown;",
      setup: "eval('record.other = other');",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("`record`");
  });

  it.each([
    [
      "alternate return",
      "function createRecord(value, other, flag) { if (flag) return { value, other }; return { value }; }",
    ],
    [
      "implicit fallthrough",
      "function createRecord(value, other, flag) { if (flag) return { value }; }",
    ],
    [
      "finally override",
      "function createRecord(value, other) { try { return { value }; } finally { return { value, other }; } }",
    ],
    ["returned alias", "function createRecord(value) { const result = { value }; return result; }"],
    ["getter", "const createRecord = (value) => ({ get value() { return value; } });"],
    ["method", "const createRecord = (value) => ({ value() { return value; } });"],
    ["unknown spread", "const createRecord = (value) => ({ ...value });"],
    ["computed key", "const createRecord = (value, other) => ({ [other]: value });"],
    ["symbol key", "const createRecord = (value) => ({ value, [Symbol.for('extra')]: value });"],
    ["quoted dotted key", "const createRecord = (value) => ({ 'value.other': value });"],
    ["empty key", "const createRecord = (value) => ({ '': value });"],
    ["numeric key", "const createRecord = (value) => ({ 0: value });"],
    ["prototype initializer", "const createRecord = (value) => ({ value, __proto__: null });"],
    ["duplicate field", "const createRecord = (value, other) => ({ value, value: other });"],
    ["async producer", "const createRecord = async (value) => ({ value });"],
    ["generator producer", "function* createRecord(value) { return { value }; }"],
    [
      "reassigned producer",
      "let createRecord = (value) => ({ value }); createRecord = (value, other) => ({ value, other });",
    ],
    [
      "reassigned declaration",
      "function createRecord(value) { return { value }; } createRecord = (value, other) => ({ value, other });",
    ],
    ["exported producer", "export const createRecord = (value) => ({ value });"],
    ["exported declaration", "export function createRecord(value) { return { value }; }"],
    ["producer alias", "const original = (value) => ({ value }); const createRecord = original;"],
    ["producer escape", "const createRecord = (value) => ({ value }); consume(createRecord);"],
  ])("declines %s", (_description, producer) => {
    const result = runSpread({ producer });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`record`");
  });

  it.each([
    ["raw escape", "consume(record);"],
    ["result alias", "const alias = record; consume(alias);"],
    ["member assignment", "record.other = other;"],
    ["member update", "record.value++;"],
    ["member deletion", "delete record.value;"],
    ["destructuring assignment", "({ value: record.value } = other);"],
    ["descriptor mutation", "Object.defineProperty(record, 'other', { value: other });"],
    ["raw identity", "consume(record === other);"],
    ["member call receiver", "record.value();"],
    ["direct eval result mutation", "eval('record.other = other');"],
    ["indirect eval capability", "globalThis.eval('void 0');"],
    ["static eval alias", "const execute = eval; consume(execute);"],
  ])("declines %s", (_description, setup) => {
    const result = runSpread({ setup });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`record`");
  });

  it.each([
    ["raw capture beside a spread", "({ fields: { ...record }, raw: record })"],
    ["array spread", "[...record]"],
    ["argument spread", "consume(...record)"],
  ])("preserves %s", (_description, expression) => {
    const result = runSpread({ expression });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("`record`");
  });

  it("does not stabilize fresh empty object identity", () => {
    const result = runSpread({
      producer: "const createRecord = () => ({});",
      expression: "record",
      dependencies: "",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("`record`");
  });

  it("preserves a direct root dependency", () => {
    expect(runSpread({ dependencies: "record" })).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("preserves independent captures", () => {
    const result = runSpread({ expression: "({ ...record, other })" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("`other`");
    expect(result.diagnostics[0]?.message).not.toContain("`record`");
  });
});
