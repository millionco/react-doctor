import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import { getAstChildKeys } from "./get-ast-child-keys.js";

describe("getAstChildKeys", () => {
  it("uses Oxc visitor keys for known nodes", () => {
    const program = {
      type: "Program",
      body: [],
      metadata: {},
    } as unknown as EsTreeNode;

    expect(getAstChildKeys(program)).toEqual(["body"]);
  });

  it("excludes parent references from unknown-node fallback keys", () => {
    const unknownNode = {
      type: "FutureNode",
      firstChild: {},
      parent: {},
      secondChild: {},
    } as unknown as EsTreeNode;

    expect(getAstChildKeys(unknownNode)).toEqual(["type", "firstChild", "secondChild"]);
  });
});
