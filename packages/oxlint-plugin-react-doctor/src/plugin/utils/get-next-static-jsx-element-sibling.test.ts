import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { defineRule } from "./define-rule.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getNextStaticJsxElementSibling } from "./get-next-static-jsx-element-sibling.js";
import { isNodeOfType } from "./is-node-of-type.js";

describe("getNextStaticJsxElementSibling", () => {
  it("skips formatting whitespace but not dynamic siblings", () => {
    const nextNames: Array<string | null> = [];
    const rule = defineRule({
      id: "test-next-static-jsx-sibling",
      title: "test",
      severity: "warn",
      create: () => ({
        JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
          if (!isNodeOfType(node.openingElement.name, "JSXIdentifier")) return;
          if (node.openingElement.name.name !== "span") return;
          const sibling = getNextStaticJsxElementSibling(node);
          nextNames.push(
            sibling && isNodeOfType(sibling.openingElement.name, "JSXIdentifier")
              ? sibling.openingElement.name.name
              : null,
          );
        },
      }),
    });
    runRule(
      rule,
      `const Example = ({ extra }) => <><span>First</span>\n<h2>Heading</h2><span>Second</span>{extra}<h2>Other</h2></>;`,
    );
    expect(nextNames).toEqual(["h2", null]);
  });
});
