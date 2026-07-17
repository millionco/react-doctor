import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { defineRule } from "./define-rule.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticJsxOpeningElements } from "./get-static-jsx-opening-elements.js";
import { isNodeOfType } from "./is-node-of-type.js";

describe("getStaticJsxOpeningElements", () => {
  it("collects explicit descendants without crossing component boundaries", () => {
    let names: string[] = [];
    const rule = defineRule({
      id: "test-static-jsx-opening-elements",
      title: "test",
      severity: "warn",
      create: () => ({
        JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
          if (!isNodeOfType(node.openingElement.name, "JSXIdentifier")) return;
          if (node.openingElement.name.name !== "main") return;
          names = getStaticJsxOpeningElements(node)
            .map((openingElement) =>
              isNodeOfType(openingElement.name, "JSXIdentifier") ? openingElement.name.name : "",
            )
            .filter(Boolean);
        },
      }),
    });
    runRule(
      rule,
      `const Page = () => <main><><section><h2>Title</h2></section></><Widget /></main>;`,
    );
    expect(names).toEqual(["main", "section", "h2", "Widget"]);
  });
});
