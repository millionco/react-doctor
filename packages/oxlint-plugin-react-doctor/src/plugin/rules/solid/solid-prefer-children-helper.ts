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
  if (node.params.length !== 1) return null;
  const firstParam = node.params[0];
  if (isNodeOfType(firstParam, "Identifier")) return firstParam.name;
  return null;
};

const isPropsChildrenAccess = (node: EsTreeNode, propsName: string): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  if (!isNodeOfType(node.object, "Identifier")) return false;
  if (node.object.name !== propsName) return false;
  if (isNodeOfType(node.property, "Identifier") && node.property.name === "children") return true;
  if (isNodeOfType(node.property, "Literal") && node.property.value === "children") return true;
  return false;
};

const countChildrenAccesses = (body: EsTreeNode, propsName: string): number => {
  let count = 0;
  walkAst(body, (node) => {
    if (isFunctionLike(node) && node !== body) return false;
    if (isPropsChildrenAccess(node, propsName)) {
      count++;
    }
  });
  return count;
};

export const solidPreferChildrenHelper = defineRule<Rule>({
  id: "solid-prefer-children-helper",
  severity: "warn",
  defaultEnabled: false,
  requires: ["solid"],
  recommendation:
    "Multiple reads of `props.children` create new DOM nodes each time. Use `children(() => props.children)` to resolve once.",
  create: (context: RuleContext) => {
    const visitFunction = (node: FunctionLikeNode): void => {
      if (!containsJsxElement(node as EsTreeNode)) return;
      const propsName = getPropsParamName(node);
      if (!propsName) return;
      const body = node.body as EsTreeNode;
      const accessCount = countChildrenAccesses(body, propsName);
      if (accessCount < 2) return;
      context.report({
        node,
        message: `\`${propsName}.children\` is accessed ${accessCount} times — each read creates new DOM. Use \`const resolved = children(() => ${propsName}.children)\` and read \`resolved()\` instead.`,
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
