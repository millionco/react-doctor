import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../../constants/thresholds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isReactApiCall } from "../is-react-api-call.js";
import { isTypeOnlyImport } from "../is-type-only-import.js";
import { stripParenExpression } from "../strip-paren-expression.js";

export const isClosedReactHookCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  hookName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isReactApiCall(call, hookName, scopes, { resolveNamedAliases: true })) return false;
  let origin = stripParenExpression(call.callee);
  const visitedSymbols = new Set<SymbolDescriptor>();
  while (visitedSymbols.size < FUNCTION_RESOLUTION_MAX_DEPTH) {
    if (isNodeOfType(origin, "MemberExpression")) origin = stripParenExpression(origin.object);
    if (!isNodeOfType(origin, "Identifier")) return false;
    const symbol = scopes.symbolFor(origin);
    if (
      !symbol ||
      symbol.references.some((reference) => reference.flag !== "read") ||
      visitedSymbols.has(symbol)
    )
      return false;
    visitedSymbols.add(symbol);
    if (symbol.kind === "import") {
      const specifier = symbol.declarationNode;
      const declaration = specifier.parent;
      return Boolean(
        declaration &&
        isNodeOfType(declaration, "ImportDeclaration") &&
        declaration.source.value === "react" &&
        !isTypeOnlyImport(declaration) &&
        (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type"),
      );
    }
    if (symbol.kind !== "const" || !symbol.initializer) return false;
    origin = stripParenExpression(symbol.initializer);
  }
  return false;
};
