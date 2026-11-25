import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  resolveImportedApiReference,
  type ImportedApiReference,
} from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ContextTimeoutCallback {
  readonly getter: ImportedApiReference;
  readonly property: string;
}

// A cheap admission check shared by the rule and the dependency collector.
// The provider and timer behavior still have to be resolved in the live project.
export const getContextTimeoutCallback = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): ContextTimeoutCallback | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  )
    return null;
  const caller = callback.parent;
  if (
    !isNodeOfType(caller, "CallExpression") ||
    caller.optional ||
    caller.arguments[0] !== callback ||
    !isNodeOfType(caller.callee, "Identifier")
  )
    return null;

  const binding = scopes.symbolFor(caller.callee);
  if (
    binding?.kind !== "const" ||
    binding.references.some((reference) => reference.flag !== "read")
  )
    return null;
  const declaration = binding.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !declaration.init
  )
    return null;
  const member = binding.bindingIdentifier.parent;
  if (
    !isNodeOfType(member, "Property") ||
    member.value !== binding.bindingIdentifier ||
    getStaticPropertyKeyName(member) !== "setTimeout"
  )
    return null;
  const initializer = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== 0 ||
    !isNodeOfType(initializer.callee, "Identifier")
  )
    return null;
  if (scopes.symbolFor(initializer.callee)?.kind !== "import") return null;
  const getter = resolveImportedApiReference(initializer.callee, scopes);
  if (!getter?.importedName || getter.isNamespace || !getter.source.startsWith(".")) return null;
  return { getter, property: "setTimeout" };
};
