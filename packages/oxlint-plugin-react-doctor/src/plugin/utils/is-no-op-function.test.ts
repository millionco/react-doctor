import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { getCallbackStatements } from "./get-callback-statements.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNoOpFunction } from "./is-no-op-function.js";

describe("isNoOpFunction", () => {
  it.each([
    ["undefined", true],
    ["void 0", true],
    ["{ ; 0; undefined; }", true],
    ["cleanupSignal", false],
    ["void cleanupSignal", false],
    ["{ cleanupSignal; }", false],
  ])("keeps AST-only identifier classification conservative: %s", (body, expected) => {
    const parsed = parseFixture(`const cleanup = () => ${body};`);
    expect(parsed.errors).toEqual([]);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program");
    const statement = parsed.program.body[0];
    if (!isNodeOfType(statement, "VariableDeclaration")) throw new Error("Expected declaration");
    const callback = statement.declarations[0]?.init;
    if (!callback) throw new Error("Expected callback");
    expect(isNoOpFunction(callback)).toBe(expected);
  });

  it.each(["localValue", "void localValue", "{ localValue; }"])(
    "uses identifier proof only when explicitly provided: %s",
    (body) => {
      const parsed = parseFixture(`const cleanup = () => ${body};`);
      expect(parsed.errors).toEqual([]);
      if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program");
      const statement = parsed.program.body[0];
      if (!isNodeOfType(statement, "VariableDeclaration")) throw new Error("Expected declaration");
      const callback = statement.declarations[0]?.init;
      if (!callback) throw new Error("Expected callback");
      expect(isNoOpFunction(callback)).toBe(false);
      expect(
        isNoOpFunction(callback, {
          isNoOpIdentifier: (identifier) => identifier.name === "localValue",
        }),
      ).toBe(true);
      expect(getCallbackStatements(callback)).toHaveLength(1);
    },
  );
});
