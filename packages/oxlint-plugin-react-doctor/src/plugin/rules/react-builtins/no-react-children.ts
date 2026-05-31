import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "`React.Children` breaks easily when the children change shape.";

const isChildrenIdentifier = (node: EsTreeNode, contextNode: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "Identifier") || node.name !== "Children") return false;
  return isImportedFromModule(contextNode, "Children", "react");
};

const isReactNamespaceMember = (node: EsTreeNode, contextNode: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const propertyName = isNodeOfType(node.property, "Identifier") ? node.property.name : null;
  if (propertyName !== "Children") return false;
  const objectInner = stripParenExpression(node.object);
  if (!isNodeOfType(objectInner, "Identifier")) return false;
  return isImportedFromModule(contextNode, objectInner.name, "react");
};

// Port of `oxc_linter::rules::react::no_react_children`. Flags
// `Children.<method>(...)` (when `Children` was imported from `"react"`)
// and `React.Children.<method>(...)` (when `React` is the local name of
// any React import). Local `Children` declarations and unrelated imports
// aren't flagged.
export const noReactChildren = defineRule<Rule>({
  id: "no-react-children",
  title: "Use of React.Children",
  severity: "warn",
  // `React.Children.only` / `React.Children.map` are valid React APIs
  // still used for legitimate runtime invariants (e.g. tooltips that
  // need exactly one child element). Discouraging them is an opinion,
  // not a bug class. Default off.
  defaultEnabled: false,
  recommendation: "Pass children as props or render them directly instead of using React.Children.",
  category: "Architecture",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeOuter = stripParenExpression(node.callee);
      if (!isNodeOfType(calleeOuter, "MemberExpression")) return;
      const memberObject = stripParenExpression(calleeOuter.object);

      if (isChildrenIdentifier(memberObject, node)) {
        context.report({ node: calleeOuter, message: MESSAGE });
        return;
      }
      if (isReactNamespaceMember(memberObject, node)) {
        context.report({ node: calleeOuter, message: MESSAGE });
      }
    },
  }),
});
