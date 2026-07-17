import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { R3F_PUBLIC_MODULES } from "./utils/r3f-public-modules.js";

const getCanvasImportSource = (name: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (isNodeOfType(name, "JSXIdentifier")) {
    const symbol = resolveConstIdentifierAlias(name, scopes);
    const importDeclaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
    return symbol &&
      getImportedName(symbol.declarationNode) === "Canvas" &&
      typeof importDeclaration?.source.value === "string" &&
      R3F_PUBLIC_MODULES.has(importDeclaration.source.value)
      ? importDeclaration.source.value
      : null;
  }
  if (
    !isNodeOfType(name, "JSXMemberExpression") ||
    name.property.name !== "Canvas" ||
    !isNodeOfType(name.object, "JSXIdentifier")
  ) {
    return null;
  }
  const namespaceSymbol = resolveConstIdentifierAlias(name.object, scopes);
  const importDeclaration = namespaceSymbol ? getImportDeclarationForSymbol(namespaceSymbol) : null;
  return namespaceSymbol &&
    isNodeOfType(namespaceSymbol.declarationNode, "ImportNamespaceSpecifier") &&
    typeof importDeclaration?.source.value === "string" &&
    R3F_PUBLIC_MODULES.has(importDeclaration.source.value)
    ? importDeclaration.source.value
    : null;
};

export const r3fWebgpuCanvasPropCompatibility = defineRule({
  id: "r3f-webgpu-canvas-prop-compatibility",
  title: "Incompatible R3F Canvas renderer prop",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Use renderer with @react-three/fiber/webgpu, gl with /legacy, and never pass both renderer APIs to one Canvas",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const importSource = getCanvasImportSource(node.name, context.scopes);
      if (!importSource) return;
      const glAttribute = getAuthoritativeJsxAttribute(node.attributes, "gl");
      const rendererAttribute = getAuthoritativeJsxAttribute(node.attributes, "renderer");
      if (glAttribute && rendererAttribute) {
        context.report({
          node: rendererAttribute,
          message:
            "This Canvas receives both gl and renderer, but R3F accepts only one renderer API",
        });
        return;
      }
      if (importSource === "@react-three/fiber/webgpu" && glAttribute) {
        context.report({
          node: glAttribute,
          message:
            "The WebGPU Canvas rejects the legacy gl prop. Configure its renderer prop instead",
        });
        return;
      }
      if (importSource === "@react-three/fiber/legacy" && rendererAttribute) {
        context.report({
          node: rendererAttribute,
          message:
            "The legacy Canvas rejects the WebGPU renderer prop. Configure its gl prop instead",
        });
      }
    },
  }),
});
