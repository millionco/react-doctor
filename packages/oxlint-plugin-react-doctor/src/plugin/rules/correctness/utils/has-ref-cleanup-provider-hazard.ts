import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { walkAst } from "../../../utils/walk-ast.js";

const providerHazardsByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const hasRefCleanupProviderHazard = (scopes: ScopeAnalysis): boolean => {
  const cachedHazard = providerHazardsByAnalysis.get(scopes);
  if (cachedHazard !== undefined) return cachedHazard;
  let hasHazard = false;
  walkAst(scopes.rootScope.node, (child: EsTreeNode) => {
    if (hasHazard || isTypeScriptTypePosition(child)) return false;
    let isErasedGlobalObject = false;
    if (isNodeOfType(child, "Identifier") && scopes.referenceFor(child)) {
      const providerSymbol = scopes.symbolFor(child);
      if (
        providerSymbol &&
        isErasedTypeScriptBinding(providerSymbol) &&
        !hasRuntimeValueBinding(providerSymbol)
      ) {
        if (["require", "ResizeObserver", "Object", "Reflect", "Function"].includes(child.name)) {
          hasHazard = true;
          return false;
        }
        isErasedGlobalObject = ["globalThis", "window", "global", "self"].includes(child.name);
      }
    }
    if (isNodeOfType(child, "ImportDeclaration")) {
      if (
        !isTypeOnlyImport(child) &&
        child.source.value === "react" &&
        child.specifiers.some((specifier) => {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            return false;
          return (
            isNodeOfType(specifier, "ImportDefaultSpecifier") ||
            isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
            getImportedName(specifier) === "default"
          );
        })
      ) {
        hasHazard = true;
      }
      return false;
    }
    if (
      isNodeOfType(child, "WithStatement") ||
      isNodeOfType(child, "ImportExpression") ||
      (isNodeOfType(child, "Identifier") &&
        child.name === "require" &&
        scopes.isGlobalReference(child)) ||
      (isNodeOfType(child, "Identifier") &&
        child.name === "ResizeObserver" &&
        scopes.isGlobalReference(child)) ||
      ["Object", "Reflect", "eval", "Function"].some((name) =>
        isProvenGlobalNamespaceReference(child, name, scopes),
      )
    ) {
      hasHazard = true;
      return false;
    }
    if (
      isNodeOfType(child, "MemberExpression") ||
      (isNodeOfType(child, "Property") && isNodeOfType(child.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(child, scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        propertyName === null ||
        ["constructor", "__proto__", "caller", "callee"].includes(propertyName)
      ) {
        hasHazard = true;
        return false;
      }
    }
    if (!isProvenGlobalObjectReference(child, scopes) && !isErasedGlobalObject) return;
    const root = findTransparentExpressionRoot(child);
    const member = root.parent;
    if (
      !isNodeOfType(child, "Identifier") ||
      child.name !== "window" ||
      (!scopes.isGlobalReference(child) && !isErasedGlobalObject) ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      member.computed ||
      member.optional ||
      getStaticPropertyName(member) !== "ResizeObserver"
    ) {
      hasHazard = true;
      return false;
    }
    const memberRoot = findTransparentExpressionRoot(member);
    const consumer = memberRoot.parent;
    if (
      !(
        isNodeOfType(consumer, "UnaryExpression") &&
        consumer.operator === "!" &&
        consumer.argument === memberRoot
      ) &&
      !(isNodeOfType(consumer, "NewExpression") && consumer.callee === memberRoot)
    ) {
      hasHazard = true;
    }
  });
  providerHazardsByAnalysis.set(scopes, hasHazard);
  return hasHazard;
};
