import { describe, expect, it } from "vite-plus/test";
import { isAstNode } from "./is-ast-node.js";

describe("isAstNode", () => {
  it("accepts own and inherited string discriminants", () => {
    const inheritedNode: unknown = Object.create({ type: "Identifier" });

    expect(isAstNode({ type: "Identifier" })).toBe(true);
    expect(isAstNode(inheritedNode)).toBe(true);
  });

  it("rejects non-string and missing discriminants", () => {
    expect(isAstNode({ type: 1 })).toBe(false);
    expect(isAstNode({})).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isAstNode(null)).toBe(false);
    expect(isAstNode(undefined)).toBe(false);
    expect(isAstNode("Identifier")).toBe(false);
  });
});
