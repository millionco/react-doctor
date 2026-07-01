import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const ALLOWED_NAMESPACES = new Set(["React", "ReactDOM", "ReactDom"]);
const MESSAGE = "`findDOMNode` crashes your app in React 19 because it was removed.";

// Port of `oxc_linter::rules::react::no_find_dom_node`. Flags
// `<NS>.findDOMNode(...)` where `<NS>` is one of `React`, `ReactDOM`,
// `ReactDom`, and a bare `findDOMNode(...)` only when it was imported
// from `react-dom` (a local helper of the same name is not React's API).
export const noFindDomNode = defineRule({
  id: "no-find-dom-node",
  title: "findDOMNode breaks component encapsulation",
  severity: "warn",
  recommendation:
    "Use a ref to reach DOM nodes because `findDOMNode` was removed in React 19 and can crash the app.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (isNodeOfType(callee, "Identifier") && callee.name === "findDOMNode") {
        if (isImportedFromModule(node, callee.name, "react-dom")) {
          context.report({ node: callee, message: MESSAGE });
        }
        return;
      }
      if (isNodeOfType(callee, "MemberExpression")) {
        if (!isNodeOfType(callee.object, "Identifier")) return;
        if (!ALLOWED_NAMESPACES.has(callee.object.name)) return;
        if (!isNodeOfType(callee.property, "Identifier")) return;
        if (callee.property.name !== "findDOMNode") return;
        context.report({ node: callee.property, message: MESSAGE });
      }
    },
  }),
});
