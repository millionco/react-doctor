import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readStaticLiteralTruthiness } from "./read-static-literal-truthiness.js";

describe("readStaticLiteralTruthiness", () => {
  it.each([
    ["/x/", true],
    ["0n", false],
    ["1n", true],
    ["0x0n", false],
    ["0x1n", true],
    ["false", false],
    ["true", true],
    ["null", false],
    ["0", false],
    ["1", true],
    ['""', false],
    ['"value"', true],
    ["ready", null],
  ])("reads the parsed truthiness of %s", (source, expected) => {
    const parsed = parseFixture(`${source};`);
    expect(parsed.errors).toEqual([]);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected program");
    const statement = parsed.program.body[0];
    if (!isNodeOfType(statement, "ExpressionStatement")) throw new Error("Expected expression");
    expect(readStaticLiteralTruthiness(statement.expression)).toBe(expected);
  });

  it.each([
    ["/x/", true],
    ["0n", false],
    ["1n", true],
  ])("reads %s when the runtime literal value is unavailable", (source, expected) => {
    const parsed = parseFixture(`${source};`);
    expect(parsed.errors).toEqual([]);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected program");
    const statement = parsed.program.body[0];
    if (!isNodeOfType(statement, "ExpressionStatement")) throw new Error("Expected expression");
    const expression = statement.expression;
    if (
      !isNodeOfType(expression, "Literal") ||
      !("regex" in expression || "bigint" in expression)
    ) {
      throw new Error("Expected a RegExp or BigInt literal");
    }
    expression.value = null;
    expect(readStaticLiteralTruthiness(expression)).toBe(expected);
  });
});
