import { BUILTIN_HOOK_NAMES } from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { functionHasReactComponentEvidence } from "./function-has-react-component-evidence.js";
import { getCalleeName } from "./get-callee-name.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasDirective } from "./has-directive.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookCall } from "./is-react-hook-call.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { symbolHasReactComponentTypeAnnotation } from "./symbol-has-react-component-type-annotation.js";
import { walkAst } from "./walk-ast.js";

interface ClosedLocalUtilityFacts {
  readonly scopes: ScopeAnalysis;
  readonly cfg: RuleContext["cfg"];
  readonly calls: ReadonlyArray<EsTreeNodeOfType<"CallExpression">> | null;
}

const programFacts = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();
const functionFacts = new WeakMap<EsTreeNode, ClosedLocalUtilityFacts>();

const hasClosedCallableSurface = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let facts = programFacts.get(scopes);
  if (!facts) {
    facts = new WeakMap();
    programFacts.set(scopes, facts);
  }
  const cached = facts.get(program);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval")
    ) {
      supported = false;
      return false;
    }
    if (!isNodeOfType(node, "MemberExpression") && !isNodeOfType(node, "Property")) return;
    const name = getResolvedStaticPropertyName(node, scopes);
    if (name === "caller" || name === "callee" || name === "arguments") {
      supported = false;
      return false;
    }
    if (!node.computed) return;
    let receiver: EsTreeNode | null = null;
    if (isNodeOfType(node, "MemberExpression")) receiver = node.object;
    else if (isNodeOfType(node.parent, "ObjectPattern")) {
      const transport = node.parent.parent;
      if (isNodeOfType(transport, "VariableDeclarator")) receiver = transport.init;
      else if (isNodeOfType(transport, "AssignmentExpression")) receiver = transport.right;
    }
    if (receiver && resolveExactLocalFunction(receiver, scopes)) supported = false;
  });
  facts.set(program, supported);
  return supported;
};

const hasExplicitStrictScope = (functionNode: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = functionNode;
  while (ancestor) {
    if (hasDirective(ancestor, "use strict")) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const computeClosedLocalUtilityCalls = (
  functionNode: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<EsTreeNodeOfType<"CallExpression">> | null => {
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") ||
    !isNodeOfType(functionNode.parent, "BlockStatement") ||
    !functionNode.body ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.returnType ||
    !findEnclosingFunction(functionNode) ||
    !hasExplicitStrictScope(functionNode)
  )
    return null;
  const binding = getDirectFunctionBindingIdentifier(functionNode);
  const program = findProgramRoot(functionNode);
  const scopes = context.scopes;
  if (
    !binding ||
    !program ||
    isReactHookName(binding.name) ||
    !hasClosedCallableSurface(program, scopes) ||
    functionHasReactComponentEvidence(functionNode, scopes, context.cfg)
  )
    return null;
  const symbols = new Set([
    ...getFunctionBindingSymbols(functionNode, scopes),
    ...getEquivalentSymbols(binding, scopes),
    ...(scopes
      .ownScopeFor(functionNode)
      ?.symbols.filter((symbol) => symbol.bindingIdentifier === binding) ?? []),
  ]);
  if (symbols.size === 0) return null;
  const calls = new Set<EsTreeNodeOfType<"CallExpression">>();
  let hasExternalDirectCall = false;
  for (const symbol of symbols) {
    if (
      symbol.bindingIdentifier !== binding ||
      !hasCompleteSymbolReferences(symbol, program, scopes) ||
      symbolHasReactComponentTypeAnnotation(symbol, scopes)
    )
      return null;
    for (const reference of symbol.references) {
      const identifier = reference.identifier;
      const root = findTransparentExpressionRoot(identifier);
      const call = root.parent;
      if (
        reference.flag !== "read" ||
        isWithinAssignmentTarget(identifier) ||
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.callee !== root
      )
        return null;
      calls.add(call);
      if (symbol.scope.node !== functionNode) hasExternalDirectCall = true;
    }
  }
  if (!hasExternalDirectCall) return null;
  let hasReactOrImplicitSelfRole = false;
  walkAst(functionNode, (node) => {
    if (hasReactOrImplicitSelfRole) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments")
    ) {
      hasReactOrImplicitSelfRole = true;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression") || findEnclosingFunction(node) !== functionNode)
      return;
    const name = getCalleeName(node);
    const imported = resolveImportedApiReference(node.callee, scopes);
    if (
      (name !== null && isReactHookName(name)) ||
      (imported?.importedName && isReactHookName(imported.importedName)) ||
      isReactHookCall(node, BUILTIN_HOOK_NAMES, scopes)
    )
      hasReactOrImplicitSelfRole = true;
  });
  return hasReactOrImplicitSelfRole ? null : [...calls];
};

export const getClosedLocalUtilityCalls = (
  functionNode: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<EsTreeNodeOfType<"CallExpression">> | null => {
  const cached = functionFacts.get(functionNode);
  if (cached && cached.scopes === context.scopes && cached.cfg === context.cfg) return cached.calls;
  const calls = computeClosedLocalUtilityCalls(functionNode, context);
  functionFacts.set(functionNode, { scopes: context.scopes, cfg: context.cfg, calls });
  return calls;
};
