import { MUTATING_ARRAY_METHODS, MUTATING_COLLECTION_METHODS } from "../constants/js.js";
import { HOOKS_WITH_DEPS } from "../constants/react.js";
import { CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH } from "../constants/thresholds.js";
import { analyzeControlFlow, type ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { findRenderPhaseComponentOrHook } from "./find-render-phase-component-or-hook.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookName } from "./is-react-hook-name.js";
import {
  isImportedFromReact,
  isReactApiCall,
  isReactNamespaceImport,
} from "./is-react-api-call.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import {
  resolveCrossFileFunctionExportWithFilePath,
  resolveCrossFileValueExportWithFilePath,
} from "./resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import {
  resolveFreshRenderValue,
  type FreshRenderValueKind,
} from "./resolve-fresh-render-value.js";
import { resolveImportedExportName } from "./find-exported-function-body.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const DEPENDENCY_HOOK_NAMES = new Set([
  ...HOOKS_WITH_DEPS,
  "useImperativeHandle",
  "useInsertionEffect",
]);

interface ResolvedHookFunction {
  readonly filePath: string | undefined;
  readonly functionNode: EsTreeNode;
  readonly programNode: EsTreeNode;
  readonly cfg: ControlFlowAnalysis;
  readonly scopes: ScopeAnalysis;
}

interface HookParameterBinding {
  readonly bindingIdentifier: EsTreeNode;
  readonly defaultExpression: EsTreeNode | null;
  readonly parameterIndex: number;
  readonly propertyName: string | null;
}

interface TaintState {
  readonly listSymbolIds: Set<number>;
  readonly valueSymbolIds: Set<number>;
}

interface ResolvedArgumentValue {
  readonly expression: EsTreeNode | null;
  readonly isProvenOmitted: boolean;
}

interface ImportedHookBinding {
  readonly exportedName: string;
  readonly source: string;
}

export interface ForwardedFreshHookDependency {
  readonly bindingName: string;
  readonly kind: FreshRenderValueKind;
  readonly origin: "argument" | "default";
  readonly reportNode: EsTreeNode;
}

const crossFileScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();
const crossFileControlFlow = new WeakMap<EsTreeNode, ControlFlowAnalysis>();
const forwardedFreshDependencyCache = new WeakMap<
  EsTreeNode,
  Map<string, ForwardedFreshHookDependency[]>
>();

const getCrossFileScopes = (resolved: { readonly programNode: EsTreeNode }): ScopeAnalysis => {
  const cached = crossFileScopes.get(resolved.programNode);
  if (cached) return cached;
  const scopes = analyzeScopes(resolved.programNode);
  crossFileScopes.set(resolved.programNode, scopes);
  return scopes;
};

const getCrossFileControlFlow = (resolved: {
  readonly programNode: EsTreeNode;
}): ControlFlowAnalysis => {
  const cached = crossFileControlFlow.get(resolved.programNode);
  if (cached) return cached;
  const cfg = analyzeControlFlow(resolved.programNode);
  crossFileControlFlow.set(resolved.programNode, cfg);
  return cfg;
};

const isNodeReachable = (node: EsTreeNode, cfg: ControlFlowAnalysis): boolean => {
  const owner = cfg.enclosingFunction(node);
  if (!owner) return true;
  const functionCfg = cfg.cfgFor(owner);
  if (!functionCfg) return true;
  const targetBlock = functionCfg.blockOf(node);
  if (!targetBlock) return true;
  const visitedBlocks = new Set([functionCfg.entry]);
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (currentBlock === targetBlock) return true;
    for (const edge of currentBlock.successors) {
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const isCustomHookFunction = (functionNode: EsTreeNode, fallbackName?: string): boolean => {
  const displayName = componentOrHookDisplayNameForFunction(functionNode) ?? fallbackName ?? "";
  return displayName !== "use" && isReactHookName(displayName);
};

const getImportedHookBinding = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
): ImportedHookBinding | null => {
  if (!isNodeOfType(callee, "Identifier")) return null;
  const importedSymbol = resolveConstIdentifierAlias(callee, scopes);
  if (importedSymbol?.kind !== "import" || !importedSymbol.initializer) return null;
  const importDeclaration = importedSymbol.initializer.parent;
  if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return null;
  const source = importDeclaration.source?.value;
  if (typeof source !== "string") return null;
  const exportedName = resolveImportedExportName(importedSymbol.initializer);
  return exportedName ? { exportedName, source } : null;
};

const resolveImportedHookFunction = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
  currentFilename: string | undefined,
): ResolvedHookFunction | null => {
  if (!currentFilename) return null;
  const importedBinding = getImportedHookBinding(callee, scopes);
  if (!importedBinding) return null;
  const localName = isNodeOfType(callee, "Identifier") ? callee.name : "";
  if (
    importedBinding.source === "react" ||
    (!isReactHookName(localName) && !isReactHookName(importedBinding.exportedName))
  ) {
    return null;
  }
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    currentFilename,
    importedBinding.source,
    importedBinding.exportedName,
  );
  if (!resolved || !isCustomHookFunction(resolved.functionNode, importedBinding.exportedName)) {
    return null;
  }
  return {
    cfg: getCrossFileControlFlow(resolved),
    filePath: resolved.filePath,
    functionNode: resolved.functionNode,
    programNode: resolved.programNode,
    scopes: getCrossFileScopes(resolved),
  };
};

const dependencyIndexForReactHookReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  dependencyHookNames: ReadonlySet<string>,
  visitedSymbolIds: Set<number> = new Set(),
): number | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(candidate, scopes);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
    if (isImportedFromReact(symbol)) {
      const importedName = getImportedName(symbol.declarationNode);
      if (!importedName || !dependencyHookNames.has(importedName)) return null;
      return importedName === "useImperativeHandle" ? 2 : 1;
    }
    if (symbol.kind !== "const" || !symbol.initializer || isSymbolMutated(symbol)) return null;
    visitedSymbolIds.add(symbol.id);
    return dependencyIndexForReactHookReference(
      symbol.initializer,
      scopes,
      dependencyHookNames,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    const hookName = getStaticPropertyName(candidate);
    if (!hookName || !dependencyHookNames.has(hookName)) return null;
    const receiver = stripParenExpression(candidate.object);
    if (!isNodeOfType(receiver, "Identifier") || !isReactNamespaceImport(receiver, scopes)) {
      return null;
    }
    return hookName === "useImperativeHandle" ? 2 : 1;
  }
  if (!isNodeOfType(candidate, "ConditionalExpression")) return null;
  const consequentIndex = dependencyIndexForReactHookReference(
    candidate.consequent,
    scopes,
    dependencyHookNames,
    new Set(visitedSymbolIds),
  );
  const alternateIndex = dependencyIndexForReactHookReference(
    candidate.alternate,
    scopes,
    dependencyHookNames,
    new Set(visitedSymbolIds),
  );
  return consequentIndex !== null && consequentIndex === alternateIndex ? consequentIndex : null;
};

const getImportedReactDependencyIndex = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  currentFilename: string | undefined,
  dependencyHookNames: ReadonlySet<string>,
): number | null => {
  if (!currentFilename) return null;
  const importedBinding = getImportedHookBinding(
    stripParenExpression(callExpression.callee),
    scopes,
  );
  if (!importedBinding) return null;
  const resolved = resolveCrossFileValueExportWithFilePath(
    currentFilename,
    importedBinding.source,
    importedBinding.exportedName,
  );
  if (!resolved) return null;
  return dependencyIndexForReactHookReference(
    resolved.exportedNode,
    getCrossFileScopes(resolved),
    dependencyHookNames,
  );
};

const resolveHookFunction = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  cfg: ControlFlowAnalysis,
  currentFilename: string | undefined,
): ResolvedHookFunction | null => {
  const callee = stripParenExpression(callExpression.callee);
  const localFunction = resolveExactLocalFunction(callee, scopes);
  if (localFunction && isCustomHookFunction(localFunction)) {
    const programNode = findProgramRoot(localFunction);
    if (!programNode) return null;
    return {
      cfg,
      filePath: currentFilename,
      functionNode: localFunction,
      programNode,
      scopes,
    };
  }
  return resolveImportedHookFunction(callee, scopes, currentFilename);
};

const collectParameterBindings = (functionNode: EsTreeNode): HookParameterBinding[] => {
  if (!isFunctionLike(functionNode)) return [];
  const bindings: HookParameterBinding[] = [];
  for (const [parameterIndex, rawParameter] of (functionNode.params ?? []).entries()) {
    const parameter = stripParenExpression(rawParameter);
    if (isNodeOfType(parameter, "Identifier")) {
      bindings.push({
        bindingIdentifier: parameter,
        defaultExpression: null,
        parameterIndex,
        propertyName: null,
      });
      continue;
    }
    if (
      isNodeOfType(parameter, "AssignmentPattern") &&
      isNodeOfType(parameter.left, "Identifier")
    ) {
      bindings.push({
        bindingIdentifier: parameter.left,
        defaultExpression: parameter.right,
        parameterIndex,
        propertyName: null,
      });
      continue;
    }
    if (!isNodeOfType(parameter, "ObjectPattern")) continue;
    for (const property of parameter.properties ?? []) {
      if (!isNodeOfType(property, "Property")) continue;
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (!propertyName) continue;
      const value = stripParenExpression(property.value);
      if (isNodeOfType(value, "Identifier")) {
        bindings.push({
          bindingIdentifier: value,
          defaultExpression: null,
          parameterIndex,
          propertyName,
        });
      } else if (
        isNodeOfType(value, "AssignmentPattern") &&
        isNodeOfType(value.left, "Identifier")
      ) {
        bindings.push({
          bindingIdentifier: value.left,
          defaultExpression: value.right,
          parameterIndex,
          propertyName,
        });
      }
    }
  }
  return bindings;
};

const resolveConstObjectExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ObjectExpression")) return candidate;
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    isSymbolMutated(symbol)
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveConstObjectExpression(symbol.initializer, scopes, visitedSymbolIds);
};

const findObjectPropertyValue = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): ResolvedArgumentValue => {
  for (
    let propertyIndex = objectExpression.properties.length - 1;
    propertyIndex >= 0;
    propertyIndex--
  ) {
    const property = objectExpression.properties[propertyIndex];
    if (isNodeOfType(property, "SpreadElement")) {
      return { expression: null, isProvenOmitted: false };
    }
    if (
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === propertyName
    ) {
      return { expression: property.value, isProvenOmitted: false };
    }
  }
  return { expression: null, isProvenOmitted: true };
};

const resolveArgumentValue = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  parameter: HookParameterBinding,
  callerScopes: ScopeAnalysis,
): ResolvedArgumentValue => {
  const argumentsBeforeOrAtParameter = (callExpression.arguments ?? []).slice(
    0,
    parameter.parameterIndex + 1,
  );
  if (argumentsBeforeOrAtParameter.some((argument) => isNodeOfType(argument, "SpreadElement"))) {
    return { expression: null, isProvenOmitted: false };
  }
  const argument = callExpression.arguments?.[parameter.parameterIndex];
  if (!argument) {
    return { expression: null, isProvenOmitted: true };
  }
  if (parameter.propertyName === null) {
    return { expression: argument, isProvenOmitted: false };
  }
  const objectExpression = resolveConstObjectExpression(argument, callerScopes);
  if (!objectExpression) return { expression: null, isProvenOmitted: false };
  return findObjectPropertyValue(objectExpression, parameter.propertyName);
};

const isSymbolMutated = (symbol: SymbolDescriptor): boolean => {
  if (symbol.references.some((reference) => reference.flag !== "read")) return true;
  for (const reference of symbol.references) {
    let expression = reference.identifier;
    while (
      expression.parent &&
      isNodeOfType(expression.parent, "MemberExpression") &&
      expression.parent.object === expression
    ) {
      expression = expression.parent;
    }
    const parent = expression.parent;
    if (
      (isNodeOfType(parent, "AssignmentExpression") && parent.left === expression) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === expression) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "delete" &&
        parent.argument === expression)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.callee === expression &&
      isNodeOfType(expression, "MemberExpression")
    ) {
      const methodName = getStaticPropertyName(expression);
      if (
        methodName &&
        (MUTATING_ARRAY_METHODS.has(methodName) || MUTATING_COLLECTION_METHODS.has(methodName))
      ) {
        return true;
      }
    }
  }
  return false;
};

const expressionHasTaint = (
  expression: EsTreeNode,
  mode: "list" | "value",
  scopes: ScopeAnalysis,
  taint: TaintState,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id) || isSymbolMutated(symbol)) return false;
  const taintedSymbolIds = mode === "value" ? taint.valueSymbolIds : taint.listSymbolIds;
  if (taintedSymbolIds.has(symbol.id)) return true;
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return expressionHasTaint(symbol.initializer, mode, scopes, taint, visitedSymbolIds);
};

const dependencyListContainsTaint = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  taint: TaintState,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (expressionHasTaint(expression, "list", scopes, taint)) return true;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      isSymbolMutated(symbol)
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return dependencyListContainsTaint(symbol.initializer, scopes, taint, visitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "ArrayExpression")) return false;
  return (candidate.elements ?? []).some((element) => {
    if (!element) return false;
    if (isNodeOfType(element, "SpreadElement")) {
      return expressionHasTaint(element.argument, "list", scopes, taint);
    }
    return expressionHasTaint(element, "value", scopes, taint);
  });
};

const buildForwardedTaint = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  target: ResolvedHookFunction,
  callerScopes: ScopeAnalysis,
  callerTaint: TaintState,
): TaintState => {
  const forwardedTaint: TaintState = {
    listSymbolIds: new Set(),
    valueSymbolIds: new Set(),
  };
  for (const parameter of collectParameterBindings(target.functionNode)) {
    const argument = resolveArgumentValue(callExpression, parameter, callerScopes);
    if (!argument.expression) continue;
    const targetSymbol = target.scopes.symbolFor(parameter.bindingIdentifier);
    if (!targetSymbol || isSymbolMutated(targetSymbol)) continue;
    if (expressionHasTaint(argument.expression, "value", callerScopes, callerTaint)) {
      forwardedTaint.valueSymbolIds.add(targetSymbol.id);
    }
    if (
      expressionHasTaint(argument.expression, "list", callerScopes, callerTaint) ||
      dependencyListContainsTaint(argument.expression, callerScopes, callerTaint)
    ) {
      forwardedTaint.listSymbolIds.add(targetSymbol.id);
    }
  }
  return forwardedTaint;
};

const taintReachesBuiltInDependency = (
  target: ResolvedHookFunction,
  taint: TaintState,
  remainingDepth: number,
  visitedFunctions: Set<EsTreeNode>,
  dependencyHookNames: ReadonlySet<string>,
): boolean => {
  if (!isFunctionLike(target.functionNode)) return false;
  const functionNode = target.functionNode;
  if (
    remainingDepth < 0 ||
    visitedFunctions.has(functionNode) ||
    [...taint.valueSymbolIds, ...taint.listSymbolIds].some((symbolId) => {
      const symbol = target.scopes
        .ownScopeFor(target.functionNode)
        ?.symbols.find((candidate) => candidate.id === symbolId);
      return symbol ? isSymbolMutated(symbol) : false;
    })
  ) {
    return false;
  }
  const nextVisitedFunctions = new Set(visitedFunctions);
  nextVisitedFunctions.add(functionNode);
  let didReachDependency = false;
  walkAst(functionNode.body, (node): boolean | void => {
    if (didReachDependency) return false;
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (!isNodeReachable(node, target.cfg)) return;
    if (
      isReactApiCall(node, dependencyHookNames, target.scopes, {
        allowGlobalReactNamespace: true,
      })
    ) {
      const callee = stripParenExpression(node.callee);
      const hookName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : isNodeOfType(callee, "MemberExpression")
          ? getStaticPropertyName(callee)
          : null;
      const dependencyIndex = hookName === "useImperativeHandle" ? 2 : 1;
      const dependencies = node.arguments?.[dependencyIndex];
      if (
        dependencies &&
        !isNodeOfType(dependencies, "SpreadElement") &&
        dependencyListContainsTaint(dependencies, target.scopes, taint)
      ) {
        didReachDependency = true;
        return false;
      }
      return;
    }
    const importedDependencyIndex = getImportedReactDependencyIndex(
      node,
      target.scopes,
      target.filePath,
      dependencyHookNames,
    );
    if (importedDependencyIndex !== null) {
      const dependencies = node.arguments?.[importedDependencyIndex];
      if (
        dependencies &&
        !isNodeOfType(dependencies, "SpreadElement") &&
        dependencyListContainsTaint(dependencies, target.scopes, taint)
      ) {
        didReachDependency = true;
        return false;
      }
      return;
    }
    if (remainingDepth === 0) return;
    const nestedTarget = resolveHookFunction(node, target.scopes, target.cfg, target.filePath);
    if (!nestedTarget) return;
    const forwardedTaint = buildForwardedTaint(node, nestedTarget, target.scopes, taint);
    if (forwardedTaint.valueSymbolIds.size === 0 && forwardedTaint.listSymbolIds.size === 0) {
      return;
    }
    if (
      taintReachesBuiltInDependency(
        nestedTarget,
        forwardedTaint,
        remainingDepth - 1,
        nextVisitedFunctions,
        dependencyHookNames,
      )
    ) {
      didReachDependency = true;
      return false;
    }
  });
  return didReachDependency;
};

export const findForwardedFreshHookDependencies = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  dependencyHookNames: ReadonlySet<string> = DEPENDENCY_HOOK_NAMES,
): ReadonlyArray<ForwardedFreshHookDependency> => {
  const cacheKey = [...dependencyHookNames].sort().join("\0");
  const cacheForCall = forwardedFreshDependencyCache.get(callExpression);
  const cached = cacheForCall?.get(cacheKey);
  if (cached) return cached;
  const findings: ForwardedFreshHookDependency[] = [];
  if (cacheForCall) {
    cacheForCall.set(cacheKey, findings);
  } else {
    forwardedFreshDependencyCache.set(callExpression, new Map([[cacheKey, findings]]));
  }
  const target = resolveHookFunction(callExpression, context.scopes, context.cfg, context.filename);
  if (!target) return findings;
  if (!findRenderPhaseComponentOrHook(callExpression, context.scopes)) return findings;
  if (!isNodeReachable(callExpression, context.cfg)) return findings;

  for (const parameter of collectParameterBindings(target.functionNode)) {
    const targetSymbol = target.scopes.symbolFor(parameter.bindingIdentifier);
    if (!targetSymbol || isSymbolMutated(targetSymbol)) continue;
    const argument = resolveArgumentValue(callExpression, parameter, context.scopes);
    const sourceExpression =
      argument.expression ?? (argument.isProvenOmitted ? parameter.defaultExpression : null);
    if (!sourceExpression) continue;
    const sourceScopes = argument.expression ? context.scopes : target.scopes;
    const freshness = resolveFreshRenderValue(sourceExpression, sourceScopes);
    if (!freshness) continue;
    const taint: TaintState = {
      listSymbolIds: new Set(),
      valueSymbolIds: new Set([targetSymbol.id]),
    };
    if (
      !taintReachesBuiltInDependency(
        target,
        taint,
        CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH,
        new Set(),
        dependencyHookNames,
      )
    ) {
      continue;
    }
    findings.push({
      bindingName:
        freshness.bindingName ??
        (isNodeOfType(parameter.bindingIdentifier, "Identifier")
          ? parameter.bindingIdentifier.name
          : "dependency"),
      kind: freshness.kind,
      origin: argument.expression ? "argument" : "default",
      reportNode: argument.expression ?? callExpression,
    });
  }
  return findings;
};
