import { describe, expect, it } from "vitest";
import { getCalleeName, isHookCall, countSetStateCalls } from "../src/plugin/helpers.js";

describe("getCalleeName", () => {
  it("returns name from Identifier node", () => {
    expect(getCalleeName({ type: "Identifier", name: "useEffect" })).toBe("useEffect");
  });

  it("returns property name from MemberExpression node", () => {
    expect(
      getCalleeName({
        type: "MemberExpression",
        object: { type: "Identifier", name: "React" },
        property: { type: "Identifier", name: "useEffect" },
      }),
    ).toBe("useEffect");
  });

  it("returns null for non-Identifier MemberExpression property", () => {
    expect(
      getCalleeName({
        type: "MemberExpression",
        object: { type: "Identifier", name: "React" },
        property: { type: "Literal", value: "useEffect" },
      }),
    ).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(getCalleeName(null)).toBeNull();
    expect(getCalleeName(undefined)).toBeNull();
  });

  it("returns null for unsupported node types", () => {
    expect(getCalleeName({ type: "CallExpression" })).toBeNull();
  });
});

describe("isHookCall", () => {
  const makeDirectCall = (name: string) => ({
    type: "CallExpression",
    callee: { type: "Identifier", name },
    arguments: [],
  });

  const makeNamespaceCall = (namespace: string, name: string) => ({
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Identifier", name: namespace },
      property: { type: "Identifier", name },
    },
    arguments: [],
  });

  it("matches direct hook call with string hookName", () => {
    expect(isHookCall(makeDirectCall("useEffect"), "useEffect")).toBe(true);
  });

  it("does not match wrong direct hook call", () => {
    expect(isHookCall(makeDirectCall("useState"), "useEffect")).toBe(false);
  });

  it("matches namespace hook call with string hookName", () => {
    expect(isHookCall(makeNamespaceCall("React", "useEffect"), "useEffect")).toBe(true);
  });

  it("matches namespace hook call with any namespace", () => {
    expect(isHookCall(makeNamespaceCall("MyLib", "useEffect"), "useEffect")).toBe(true);
  });

  it("matches direct hook call with Set hookName", () => {
    const hooks = new Set(["useEffect", "useLayoutEffect"]);
    expect(isHookCall(makeDirectCall("useEffect"), hooks)).toBe(true);
    expect(isHookCall(makeDirectCall("useLayoutEffect"), hooks)).toBe(true);
    expect(isHookCall(makeDirectCall("useState"), hooks)).toBe(false);
  });

  it("matches namespace hook call with Set hookName", () => {
    const hooks = new Set(["useEffect", "useLayoutEffect"]);
    expect(isHookCall(makeNamespaceCall("React", "useEffect"), hooks)).toBe(true);
    expect(isHookCall(makeNamespaceCall("React", "useState"), hooks)).toBe(false);
  });

  it("rejects non-CallExpression nodes", () => {
    expect(isHookCall({ type: "Identifier", name: "useEffect" }, "useEffect")).toBe(false);
  });
});

describe("countSetStateCalls", () => {
  it("counts direct setter calls", () => {
    const node = {
      type: "BlockStatement",
      body: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "CallExpression",
            callee: { type: "Identifier", name: "setName" },
            arguments: [{ type: "Literal", value: "John" }],
          },
        },
        {
          type: "ExpressionStatement",
          expression: {
            type: "CallExpression",
            callee: { type: "Identifier", name: "setAge" },
            arguments: [{ type: "Literal", value: 30 }],
          },
        },
      ],
    };
    expect(countSetStateCalls(node)).toBe(2);
  });

  it("counts namespace setter calls (React.useState pattern)", () => {
    const node = {
      type: "BlockStatement",
      body: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "CallExpression",
            callee: {
              type: "MemberExpression",
              object: { type: "Identifier", name: "actions" },
              property: { type: "Identifier", name: "setName" },
            },
            arguments: [{ type: "Literal", value: "John" }],
          },
        },
      ],
    };
    expect(countSetStateCalls(node)).toBe(1);
  });

  it("does not count non-setter calls", () => {
    const node = {
      type: "BlockStatement",
      body: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "CallExpression",
            callee: { type: "Identifier", name: "fetchData" },
            arguments: [],
          },
        },
      ],
    };
    expect(countSetStateCalls(node)).toBe(0);
  });
});
