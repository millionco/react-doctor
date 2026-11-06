import { STENCIL_CORE_PACKAGE } from "../constants/stencil.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingClass } from "./find-enclosing-class.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { collectJsxRuntimeImports } from "./non-react-jsx-dialect.js";
import type { RuleContext } from "./rule-context.js";

const stencilSourceSupport = new WeakMap<RuleContext, boolean>();

const sourceSupportsStencilJsx = (node: EsTreeNode, context: RuleContext): boolean => {
  const cached = stencilSourceSupport.get(context);
  if (cached !== undefined) return cached;
  const sourceText = context.getSourceText?.() ?? context.sourceCode?.getText?.();
  const program = findProgramRoot(node);
  const supported = Boolean(
    sourceText?.includes(STENCIL_CORE_PACKAGE) &&
    !sourceText.includes("@jsx") &&
    isNodeOfType(program, "Program") &&
    !collectJsxRuntimeImports(program).hasReactRuntime,
  );
  stencilSourceSupport.set(context, supported);
  return supported;
};

const isStencilImport = (symbol: SymbolDescriptor | undefined | null, name: string): boolean =>
  Boolean(
    symbol &&
    getValueImportSource(symbol) === STENCIL_CORE_PACKAGE &&
    getImportedName(symbol.declarationNode) === name,
  );

export const isStencilComponentJsx = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!sourceSupportsStencilJsx(node, context)) return false;
  const { scopes } = context;
  if (!isStencilImport(scopes.rootScope.symbolsByName.get("h"), "h")) return false;
  const enclosingClass = findEnclosingClass(node);
  if (
    !enclosingClass?.decorators?.some(
      ({ expression }) =>
        isNodeOfType(expression, "CallExpression") &&
        isNodeOfType(expression.callee, "Identifier") &&
        expression.callee.name === "Component" &&
        isStencilImport(scopes.symbolFor(expression.callee), "Component"),
    )
  ) {
    return false;
  }
  const ownerMethod = findEnclosingFunction(node)?.parent;
  if (
    !isNodeOfType(ownerMethod, "MethodDefinition") ||
    ownerMethod.static ||
    ownerMethod.kind !== "method"
  ) {
    return false;
  }
  let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(node);
  while (scope) {
    const factory = scope.symbolsByName.get("h");
    if (factory) {
      if (!isStencilImport(factory, "h")) return false;
      break;
    }
    scope = scope.parent;
  }
  return scope !== null;
};
