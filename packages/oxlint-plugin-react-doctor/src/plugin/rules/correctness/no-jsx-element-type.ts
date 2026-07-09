import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
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

const isJsxImportBinding = (node: EsTreeNodeOfType<"ImportDeclaration">): boolean => {
  for (const specifier of node.specifiers ?? []) {
    if (
      isNodeOfType(specifier, "ImportSpecifier") ||
      isNodeOfType(specifier, "ImportNamespaceSpecifier")
    ) {
      if (isNodeOfType(specifier.local, "Identifier") && specifier.local.name === "JSX")
        return true;
    }
  }
  return false;
};

const extractReturnTypeAnnotation = (
  returnType: EsTreeNodeOfType<"TSTypeAnnotation"> | undefined,
): EsTreeNode | null => {
  if (!returnType) return null;
  if (!isNodeOfType(returnType, "TSTypeAnnotation")) return null;
  return returnType.typeAnnotation ?? null;
};

export const noJsxElementType = defineRule({
  id: "no-jsx-element-type",
  title: "No JSX.Element",
  // A `JSX.Element` return-type annotation is a type-hygiene preference
  // (too narrow for what components legitimately return), not a runtime
  // bug — it must not block a scan at error severity.
  severity: "warn",
  recommendation:
    "Replace `JSX.Element` with `React.ReactNode`. `JSX.Element` is too narrow: it excludes `null`, strings, numbers, and fragments that components commonly return.",
  create: (context: RuleContext) => {
    // When `JSX` is an imported binding, `JSX.Element` is not the global
    // React namespace this rule targets: Solid/Preact export their own `JSX`
    // whose `Element` is the idiomatic (and in Solid, already-wide) type with
    // no `React.ReactNode` to switch to, and React 19's
    // `import { JSX } from "react"` makes it exactly `React.JSX.Element`,
    // a spelling this rule deliberately accepts.
    let isJsxImported = false;
    const flaggedAnnotations: EsTreeNode[] = [];

    const checkReturnType = (
      returnType: EsTreeNodeOfType<"TSTypeAnnotation"> | undefined,
    ): void => {
      const typeAnnotation = extractReturnTypeAnnotation(returnType);
      if (!typeAnnotation) return;
      if (isJsxElementTypeReference(typeAnnotation)) {
        flaggedAnnotations.push(typeAnnotation);
      }
    };

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (isJsxImportBinding(node)) isJsxImported = true;
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        checkReturnType(node.returnType);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        checkReturnType(node.returnType);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        checkReturnType(node.returnType);
      },
      TSDeclareFunction(node: EsTreeNodeOfType<"TSDeclareFunction">) {
        checkReturnType(node.returnType);
      },
      TSMethodSignature(node: EsTreeNodeOfType<"TSMethodSignature">) {
        checkReturnType(node.returnType);
      },
      "Program:exit"() {
        if (isJsxImported) return;
        for (const typeAnnotation of flaggedAnnotations) {
          context.report({ node: typeAnnotation, message: MESSAGE });
        }
      },
    };
  },
});
