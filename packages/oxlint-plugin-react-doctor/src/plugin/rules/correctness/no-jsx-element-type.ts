import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "`JSX.Element` is too narrow: it excludes `null`, strings, numbers, and fragments that components commonly return. Use `React.ReactNode` instead.";

const isJsxElementTypeReference = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "TSTypeReference")) return false;
  const typeName = node.typeName;
  if (!isNodeOfType(typeName, "TSQualifiedName")) return false;
  return (
    isNodeOfType(typeName.left, "Identifier") &&
    typeName.left.name === "JSX" &&
    isNodeOfType(typeName.right, "Identifier") &&
    typeName.right.name === "Element"
  );
};

const extractReturnTypeAnnotation = (
  returnType: EsTreeNodeOfType<"TSTypeAnnotation"> | undefined,
): EsTreeNode | null => {
  if (!returnType) return null;
  if (!isNodeOfType(returnType, "TSTypeAnnotation")) return null;
  return returnType.typeAnnotation ?? null;
};

const checkReturnType = (
  context: RuleContext,
  returnType: EsTreeNodeOfType<"TSTypeAnnotation"> | undefined,
): void => {
  const typeAnnotation = extractReturnTypeAnnotation(returnType);
  if (!typeAnnotation) return;
  if (isJsxElementTypeReference(typeAnnotation)) {
    context.report({ node: typeAnnotation, message: MESSAGE });
  }
};

export const noJsxElementType = defineRule<Rule>({
  id: "no-jsx-element-type",
  title: "No JSX.Element",
  severity: "error",
  recommendation:
    "Replace `JSX.Element` with `React.ReactNode`. `JSX.Element` is too narrow: it excludes `null`, strings, numbers, and fragments that components commonly return.",
  create: (context: RuleContext) => ({
    FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
      checkReturnType(context, node.returnType);
    },
    ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
      checkReturnType(context, node.returnType);
    },
    FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
      checkReturnType(context, node.returnType);
    },
    TSDeclareFunction(node: EsTreeNodeOfType<"TSDeclareFunction">) {
      checkReturnType(context, node.returnType);
    },
    TSMethodSignature(node: EsTreeNodeOfType<"TSMethodSignature">) {
      checkReturnType(context, node.returnType);
    },
  }),
});
