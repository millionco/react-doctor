import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isImportedFromReact, isReactNamespaceImport } from "./is-react-api-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";

// Port of `oxc_linter::utils::react::is_jsx_fragment`. Returns true when a
// JSXOpeningElement is `<Fragment>` or `<React.Fragment>`. The shorthand
// `<>...</>` syntax is a separate AST node (`JSXFragment`) and is not
// covered here.
export const isJsxFragmentElement = (node: EsTreeNode, scopes?: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "JSXOpeningElement")) return false;
  const elementName = node.name;

  if (isNodeOfType(elementName, "JSXIdentifier")) {
    if (!scopes) return elementName.name === "Fragment";
    const symbol = resolveConstIdentifierAlias(elementName, scopes);
    if (!symbol) {
      return elementName.name === "Fragment" && scopes.isGlobalReference(elementName);
    }
    return isImportedFromReact(symbol) && getImportedName(symbol.declarationNode) === "Fragment";
  }

  if (isNodeOfType(elementName, "JSXMemberExpression")) {
    if (!isNodeOfType(elementName.object, "JSXIdentifier")) return false;
    if (elementName.property.name !== "Fragment") return false;
    if (!scopes) return elementName.object.name === "React";
    if (isReactNamespaceImport(elementName.object, scopes)) return true;
    return elementName.object.name === "React" && scopes.isGlobalReference(elementName.object);
  }

  return false;
};
