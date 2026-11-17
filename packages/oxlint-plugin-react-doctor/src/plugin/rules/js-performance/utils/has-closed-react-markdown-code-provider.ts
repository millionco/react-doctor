import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { getRequireCallSource } from "../../../utils/get-require-call-source.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  REACT_MARKDOWN_FIRST_VALUE_INDEX,
  REACT_MARKDOWN_RUNTIME_TYPESCRIPT_NODES,
} from "./constants.js";

const closedProviders = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedReactMarkdownCodeProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = closedProviders.get(scopes);
  if (cached !== undefined) return cached;
  const runtimeProviderScopes: ScopeAnalysis = {
    ...scopes,
    isGlobalReference: (identifier) => {
      if (scopes.isGlobalReference(identifier)) return true;
      const symbol = scopes.symbolFor(identifier);
      return (
        scopes.referenceFor(identifier) !== null &&
        Boolean(symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol))
      );
    },
  };
  let hasUnsupportedRuntime = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasUnsupportedRuntime) return false;
    if (
      ("declare" in node && node.declare === true) ||
      node.type === "WithStatement" ||
      REACT_MARKDOWN_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      ((isNodeOfType(node, "TSEnumDeclaration") || isNodeOfType(node, "TSModuleDeclaration")) &&
        !node.declare)
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ImportExpression")) {
      const source = getStaticStringExpression(node.source);
      if (source === null || source === "react-markdown") {
        hasUnsupportedRuntime = true;
        return false;
      }
    }
    if (
      (isNodeOfType(node, "Identifier") && scopes.referenceFor(node) !== null) ||
      isNodeOfType(node, "MemberExpression")
    ) {
      const isRequire = isProvenGlobalNamespaceReference(node, "require", runtimeProviderScopes);
      if (isRequire || isProvenGlobalNamespaceReference(node, "eval", runtimeProviderScopes)) {
        const root = findTransparentExpressionRoot(node);
        const consumer = root.parent;
        const source =
          isRequire && isNodeOfType(consumer, "CallExpression") && consumer.callee === root
            ? (getRequireCallSource(consumer) ??
              getStaticStringExpression(consumer.arguments[REACT_MARKDOWN_FIRST_VALUE_INDEX]))
            : null;
        if (source === null || source === "react-markdown") {
          hasUnsupportedRuntime = true;
          return false;
        }
      }
    }
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.source.value !== "react-markdown" ||
      isTypeOnlyImport(node)
    ) {
      return undefined;
    }
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const importedSymbol = scopes.symbolFor(specifier.local);
      if (!isNodeOfType(specifier, "ImportDefaultSpecifier") || !importedSymbol) {
        hasUnsupportedRuntime = true;
        return false;
      }
      for (const reference of importedSymbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        const parent = reference.identifier.parent;
        if (
          reference.flag !== "read" ||
          isWithinAssignmentTarget(reference.identifier) ||
          !isNodeOfType(reference.identifier, "JSXIdentifier") ||
          (!isNodeOfType(parent, "JSXOpeningElement") &&
            !isNodeOfType(parent, "JSXClosingElement")) ||
          parent.name !== reference.identifier
        ) {
          hasUnsupportedRuntime = true;
          return false;
        }
      }
    }
    return undefined;
  });
  const isClosed = !hasUnsupportedRuntime;
  closedProviders.set(scopes, isClosed);
  return isClosed;
};
