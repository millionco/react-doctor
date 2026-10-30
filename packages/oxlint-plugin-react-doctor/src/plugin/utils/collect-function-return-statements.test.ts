import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { isNodeOfType } from "./is-node-of-type.js";
import * as astWalker from "./walk-ast.js";

const parseFunction = (source: string) => {
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected a program");
  for (const statement of parsed.program.body) {
    if (isNodeOfType(statement, "FunctionDeclaration")) {
      return { owner: statement, program: parsed.program, scopes: analyzeScopes(parsed.program) };
    }
  }
  throw new Error("Expected a function declaration");
};

afterEach(() => vi.restoreAllMocks());

describe("collectFunctionReturnStatements", () => {
  it("collects each immutable owner and scope pair once and returns fresh mutable arrays", () => {
    const { owner, scopes } = parseFunction(
      "function owner() { if (ready) return first; return second; }",
    );
    const walker = vi.spyOn(astWalker, "walkAst");
    const first = collectFunctionReturnStatements(owner, scopes);
    expect(first).toHaveLength(2);
    const firstReturn = first[0];
    const secondReturn = first[1];
    first.length = 0;
    const second = collectFunctionReturnStatements(owner, scopes);
    const third = collectFunctionReturnStatements(owner, scopes);
    expect(second).toEqual([firstReturn, secondReturn]);
    expect(third).toEqual(second);
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(walker.mock.calls.filter(([root]) => root === owner.body)).toHaveLength(1);
  });

  it("excludes nested function and class returns and isolates parsed owners", () => {
    const source = `function owner() {
      const nested = () => { return nestedValue; };
      class Nested { method() { return classValue; } }
      return ownerValue;
    }`;
    const { owner: firstOwner, scopes: firstScopes } = parseFunction(source);
    const { owner: secondOwner, scopes: secondScopes } = parseFunction(source);
    const walker = vi.spyOn(astWalker, "walkAst");
    const first = collectFunctionReturnStatements(firstOwner, firstScopes);
    const second = collectFunctionReturnStatements(secondOwner, secondScopes);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]?.argument).toMatchObject({ type: "Identifier", name: "ownerValue" });
    expect(walker.mock.calls.filter(([root]) => root === firstOwner.body)).toHaveLength(1);
    expect(walker.mock.calls.filter(([root]) => root === secondOwner.body)).toHaveLength(1);
  });

  it("memoizes an empty owner without sharing the returned empty array", () => {
    const { owner, scopes } = parseFunction("function owner() { consume(); }");
    const walker = vi.spyOn(astWalker, "walkAst");
    const first = collectFunctionReturnStatements(owner, scopes);
    const second = collectFunctionReturnStatements(owner, scopes);
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(first).not.toBe(second);
    expect(walker.mock.calls.filter(([root]) => root === owner.body)).toHaveLength(1);
  });

  it("keeps unscoped calls fresh after the owner body changes", () => {
    const { owner, scopes } = parseFunction("function owner() { return original; }");
    expect(collectFunctionReturnStatements(owner, scopes)).toHaveLength(1);
    expect(collectFunctionReturnStatements(owner)).toHaveLength(1);
    owner.body.body = [];
    expect(collectFunctionReturnStatements(owner)).toEqual([]);
  });

  it("recollects the same owner for a new scope analysis", () => {
    const { owner, program, scopes } = parseFunction("function owner() { return original; }");
    const originalReturns = collectFunctionReturnStatements(owner, scopes);
    expect(originalReturns).toHaveLength(1);
    owner.body.body = [];
    expect(collectFunctionReturnStatements(owner, analyzeScopes(program))).toEqual([]);
    expect(collectFunctionReturnStatements(owner, scopes)).toEqual(originalReturns);
  });
});
