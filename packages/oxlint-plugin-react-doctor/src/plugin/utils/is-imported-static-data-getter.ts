import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const staticGetterByFunction = new WeakMap<EsTreeNode, boolean>();

const isStaticDataExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) return true;
  if (isNodeOfType(candidate, "TemplateLiteral")) {
    return candidate.expressions.every((value) =>
      isStaticDataExpression(value, scopes, visitedSymbols),
    );
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.every(
      (value) => !value || isStaticDataExpression(value, scopes, visitedSymbols),
    );
  }
  if (isNodeOfType(candidate, "ObjectExpression")) {
    return candidate.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== null &&
        isStaticDataExpression(property.value, scopes, visitedSymbols),
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbols.has(symbol.id))
    return false;
  return isStaticDataExpression(symbol.initializer, scopes, new Set(visitedSymbols).add(symbol.id));
};

export const isImportedStaticDataGetter = (callee: EsTreeNode, context: RuleContext): boolean => {
  if (!context.filename) return false;
  const imported = resolveImportedApiReference(callee, context.scopes);
  if (!imported?.importedName || !imported.source.startsWith(".")) return false;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    imported.source,
    imported.importedName,
  );
  if (!resolved || !isFunctionLike(resolved.functionNode)) return false;
  const cached = staticGetterByFunction.get(resolved.functionNode);
  if (cached !== undefined) return cached;
  const scopes = analyzeScopes(resolved.programNode);
  const returned = getSingleReturnExpression(resolved.functionNode);
  const bindings = getFunctionBindingSymbols(resolved.functionNode, scopes);
  const isStaticGetter = Boolean(
    resolved.functionNode.params.length === 0 &&
    !resolved.functionNode.async &&
    !resolved.functionNode.generator &&
    bindings.every((binding) =>
      binding.references.every((reference) => reference.flag === "read"),
    ) &&
    returned &&
    isStaticDataExpression(returned, scopes),
  );
  staticGetterByFunction.set(resolved.functionNode, isStaticGetter);
  return isStaticGetter;
};
