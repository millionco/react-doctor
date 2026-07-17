import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { defineRule } from "./define-rule.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticJsxText } from "./get-static-jsx-text.js";
import { isNodeOfType } from "./is-node-of-type.js";

describe("getStaticJsxText", () => {
  it("collects nested literal and conditional text", () => {
    let collectedText = "";
    const rule = defineRule({
      id: "test-static-jsx-text",
      title: "test",
      severity: "warn",
      create: () => ({
        JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
          if (
            !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
            node.openingElement.name.name !== "p"
          ) {
            return;
          }
          collectedText = getStaticJsxText(node);
        },
      }),
    });
    runRule(
      rule,
      `const Example = ({ ready }) => <p>Hello <strong>world</strong>{ready ? " now" : " later"}</p>;`,
    );
    expect(collectedText.replace(/\s+/g, " ").trim()).toBe("Hello world now later");
  });
});
