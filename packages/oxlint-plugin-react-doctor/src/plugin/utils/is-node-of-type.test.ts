import { describe, expect, it } from "vite-plus/test";
import { isNodeOfType } from "./is-node-of-type.js";

describe("isNodeOfType", () => {
  it("matches an own type discriminant", () => {
    expect(isNodeOfType({ type: "Identifier" }, "Identifier")).toBe(true);
    expect(isNodeOfType({ type: "Literal" }, "Identifier")).toBe(false);
  });

  it("matches an inherited type discriminant", () => {
    const node: unknown = Object.create({ type: "Identifier" });

    expect(isNodeOfType(node, "Identifier")).toBe(true);
  });

  it("rejects non-node values", () => {
    expect(isNodeOfType(null, "Identifier")).toBe(false);
    expect(isNodeOfType(undefined, "Identifier")).toBe(false);
    expect(isNodeOfType("Identifier", "Identifier")).toBe(false);
    expect(isNodeOfType({}, "Identifier")).toBe(false);
  });
});
