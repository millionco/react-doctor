import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

type FunctionLikeNode =
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression">;

const getPropsParamName = (node: FunctionLikeNode): string | null => {
  if (node.params.length < 1) return null;
  const firstParam = node.params[0];
  if (isNodeOfType(firstParam, "Identifier")) return firstParam.name;
  return null;
};

const isPropsAccess = (node: EsTreeNode, propsParamName: string): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  if (isNodeOfType(node.object, "Identifier")) {
    return node.object.name === propsParamName;
  }
  return isPropsAccess(node.object as EsTreeNode, propsParamName);
};

const isWrappedInArrowFunction = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression");

const getMemberExpressionText = (node: EsTreeNodeOfType<"MemberExpression">): string => {
  const property = isNodeOfType(node.property, "Identifier") ? node.property.name : "[computed]";
  const object = isNodeOfType(node.object, "Identifier")
    ? node.object.name
    : isNodeOfType(node.object, "MemberExpression")
      ? getMemberExpressionText(node.object)
      : "?";
  return `${object}.${property}`;
};

export const solidNoPropsAssignment = defineRule<Rule>({
  id: "solid-no-props-assignment",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Assigning `props.x` to a variable captures the value once and breaks reactivity. Use an accessor: `const x = () => props.x`.",
  create: (context: RuleContext) => {
    const visitFunction = (node: FunctionLikeNode): void => {
      if (!containsJsxElement(node as EsTreeNode)) return;
      const propsParamName = getPropsParamName(node);
      if (!propsParamName) return;
      const body = node.body as EsTreeNode;

      walkAst(body, (child) => {
        if (isFunctionLike(child) && child !== body) return false;

        if (!isNodeOfType(child, "VariableDeclarator")) return;
        const initializer = child.init as EsTreeNode | null;
        if (!initializer) return;

        if (isWrappedInArrowFunction(initializer)) return;

        if (!isNodeOfType(initializer, "MemberExpression")) return;
        if (!isPropsAccess(initializer, propsParamName)) return;

        const accessText = getMemberExpressionText(initializer);
        context.report({
          node: child,
          message: `\`${accessText}\` is captured once at component init — this breaks Solid reactivity. Use an accessor: \`const ${isNodeOfType(child.id, "Identifier") ? child.id.name : "value"} = () => ${accessText}\`.`,
        });
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        visitFunction(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        visitFunction(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        visitFunction(node);
      },
    };
  },
});
