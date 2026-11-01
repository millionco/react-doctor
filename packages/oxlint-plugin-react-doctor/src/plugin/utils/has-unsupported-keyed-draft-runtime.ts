import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { someAst } from "./some-ast.js";
import { walkAst } from "./walk-ast.js";

const UNSUPPORTED_RUNTIME_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Reflect",
  "globalThis",
  "global",
  "window",
  "self",
  "React",
  "require",
]);

export const hasUnsupportedKeyedDraftRuntime = (program: EsTreeNode): boolean => {
  const unsupportedRuntimeNames = new Set(UNSUPPORTED_RUNTIME_NAMES);
  someAst(program, (node) => {
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.importKind === "type" ||
      node.source.value !== "react"
    )
      return false;
    for (const specifier of node.specifiers) {
      if (
        !isNodeOfType(specifier, "ImportSpecifier") ||
        (specifier.importKind !== "type" && getStaticKeyName(specifier.imported) === "default")
      ) {
        unsupportedRuntimeNames.add(specifier.local.name);
      }
    }
    return false;
  });
  let unsupported = false;
  walkAst(program, (node) => {
    if (unsupported || isKeyedDraftTypeReference(node)) return false;
    if (
      (isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "constructor") ||
      (isNodeOfType(node, "Property") &&
        getStaticKeyName(node.key) === "constructor" &&
        (isNodeOfType(node.parent, "ObjectPattern") || node.computed || node.shorthand))
    ) {
      unsupported = true;
      return false;
    }
    if (isNodeOfType(node, "ImportExpression") || isNodeOfType(node, "TSImportEqualsDeclaration")) {
      unsupported = true;
      return false;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      (node.source.value === "react/jsx-runtime" || node.source.value === "react/jsx-dev-runtime")
    ) {
      unsupported = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !unsupportedRuntimeNames.has(node.name)) return;
    const parent = node.parent;
    if (
      parent &&
      "key" in parent &&
      parent.key === node &&
      "computed" in parent &&
      !parent.computed &&
      (isNodeOfType(parent, "Property")
        ? !parent.shorthand || parent.value !== node
        : isNodeOfType(parent, "MethodDefinition") ||
          isNodeOfType(parent, "PropertyDefinition") ||
          isNodeOfType(parent, "AccessorProperty"))
    )
      return;
    unsupported = !(
      (isNodeOfType(parent, "ImportSpecifier") ||
        isNodeOfType(parent, "ImportNamespaceSpecifier") ||
        isNodeOfType(parent, "ImportDefaultSpecifier")) &&
      parent.local === node
    );
    if (unsupported) return false;
  });
  return unsupported;
};
