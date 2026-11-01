import { describe, expect, it } from "vite-plus/test";
import { REF_NOTIFICATION_WORK_COMPONENT_COUNT } from "../rules/state-and-effects/utils/constants.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";

describe("hasVisibleAmbientFunctionDeclaration", () => {
  it.each(["const unrelated = 0; declare function candidate(): void;", "const unrelated = 0;"])(
    "caches present and absent declarations separately by scope and name: %s",
    (code) => {
      const parsed = parseFixture(code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const owner = scopes.rootScope.node;
      if (owner.type !== "Program") throw new Error("Expected program scope");
      const statements = owner.body;
      const originalSome = statements.some.bind(statements);
      let statementVisits = 0;
      Object.defineProperty(statements, "some", {
        configurable: true,
        value: (predicate: Parameters<typeof statements.some>[0]) =>
          originalSome((statement, index, array) => {
            statementVisits += 1;
            return predicate(statement, index, array);
          }),
      });
      const queriedNames = ["candidate", "missing"];
      for (const name of queriedNames) {
        for (
          let queryIndex = 0;
          queryIndex < REF_NOTIFICATION_WORK_COMPONENT_COUNT;
          queryIndex += 1
        ) {
          expect(hasVisibleAmbientFunctionDeclaration(scopes.rootScope, name)).toBe(
            name === "candidate" && code.includes("declare function"),
          );
        }
      }
      expect(statementVisits).toBe(statements.length * queriedNames.length);
    },
  );

  it.each([
    { code: "declare function candidate(): void;", expected: true, nested: false },
    { code: "export declare function candidate(): void;", expected: true, nested: false },
    { code: "function candidate(): void;", expected: true, nested: false },
    {
      code: "declare function candidate(): void; function owner() {}",
      expected: true,
      nested: true,
    },
    {
      code: "function owner() { declare function candidate(): void; }",
      expected: true,
      nested: true,
    },
    { code: "declare function unrelated(): void;", expected: false, nested: false },
    {
      code: "function owner() { declare function candidate(): void; }",
      expected: false,
      nested: false,
    },
    { code: "function candidate() {}", expected: false, nested: false },
    { code: "interface candidate {}", expected: false, nested: false },
    { code: "declare const candidate: unknown;", expected: false, nested: false },
    { code: "export default function candidate(): void;", expected: true, nested: false },
  ])("checks $code", ({ code, expected, nested }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const scope = nested
      ? scopes.rootScope.children.find((candidate) => candidate.kind === "function")
      : scopes.rootScope;
    expect(scope).toBeDefined();
    if (!scope) throw new Error("Missing fixture scope");
    expect(hasVisibleAmbientFunctionDeclaration(scope, "candidate")).toBe(expected);
  });
});
