import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const stabilityByOriginBinding = new WeakMap<
  EsTreeNode,
  Map<string, Map<ReadonlySet<string>, boolean>>
>();
const directEvalScopesByAnalysis = new WeakMap<ScopeAnalysis, ScopeDescriptor[]>();
const arrayPrototypeMutationByAnalysis = new WeakMap<ScopeAnalysis, Map<string, boolean>>();
const DEFAULT_ALLOWED_ARRAY_METHOD_NAMES: ReadonlySet<string> = new Set(["includes"]);

const isDescendantOf = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const isExportedBinding = (bindingIdentifier: EsTreeNode): boolean => {
  const declarator = bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  const declaration = declarator.parent;
  return Boolean(declaration?.parent && isNodeOfType(declaration.parent, "ExportNamedDeclaration"));
};

const getTransparentExpressionRoot = (expression: EsTreeNode): EsTreeNode => {
  let current = expression;
  let parent = current.parent;
  while (
    parent &&
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) &&
    "expression" in parent &&
    parent.expression === current
  ) {
    current = parent;
    parent = current.parent;
  }
  return current;
};

const getDirectConstAliasSymbol = (
  reference: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const expressionRoot = getTransparentExpressionRoot(reference);
  const declarator = expressionRoot.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (declarator.init !== expressionRoot || !isNodeOfType(declarator.id, "Identifier")) return null;
  const aliasSymbol = scopes.symbolFor(declarator.id);
  return aliasSymbol?.kind === "const" ? aliasSymbol : null;
};

const isWriteTarget = (node: EsTreeNode): boolean => {
  let current = node;
  let parent = current.parent;
  while (
    parent &&
    (isNodeOfType(parent, "ArrayPattern") ||
      isNodeOfType(parent, "ObjectPattern") ||
      isNodeOfType(parent, "Property") ||
      isNodeOfType(parent, "RestElement") ||
      isNodeOfType(parent, "AssignmentPattern"))
  ) {
    current = parent;
    parent = current.parent;
  }
  if (!parent) return false;
  return (
    (isNodeOfType(parent, "AssignmentExpression") && parent.left === current) ||
    (isNodeOfType(parent, "UpdateExpression") && parent.argument === current) ||
    (isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "delete" &&
      parent.argument === current) ||
    ((isNodeOfType(parent, "ForInStatement") || isNodeOfType(parent, "ForOfStatement")) &&
      parent.left === current)
  );
};

const isSafeArrayMemberRead = (
  member: EsTreeNode,
  allowedMethodNames: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(member, "MemberExpression") || isWriteTarget(member)) return false;
  const parent = member.parent;
  if (parent && isNodeOfType(parent, "CallExpression") && parent.callee === member) {
    return allowedMethodNames.has(getStaticPropertyName(member) ?? "");
  }
  if (parent && isNodeOfType(parent, "MemberExpression") && parent.object === member) {
    const propertyName = getStaticPropertyName(member);
    return member.computed || (propertyName !== "__proto__" && propertyName !== "constructor");
  }
  return member.computed || getStaticPropertyName(member) === "length";
};

const isSafeBindingReference = (
  reference: EsTreeNode,
  allowedMethodNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const aliasSymbol = getDirectConstAliasSymbol(reference, scopes);
  if (aliasSymbol) return !isExportedBinding(aliasSymbol.bindingIdentifier);
  const expressionRoot = getTransparentExpressionRoot(reference);
  const parent = expressionRoot.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === expressionRoot) {
    return isSafeArrayMemberRead(parent, allowedMethodNames);
  }
  return (
    (isNodeOfType(parent, "SpreadElement") && parent.argument === expressionRoot) ||
    (isNodeOfType(parent, "ForOfStatement") && parent.right === expressionRoot)
  );
};

const collectStableOrigin = (
  receiver: EsTreeNode,
  containingLoop: EsTreeNode,
  symbols: Set<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const strippedReceiver = stripParenExpression(receiver);
  if (!isNodeOfType(strippedReceiver, "Identifier")) return null;
  const symbol = scopes.symbolFor(strippedReceiver);
  if (
    !symbol?.initializer ||
    symbol.kind !== "const" ||
    isExportedBinding(symbol.bindingIdentifier) ||
    symbols.has(symbol) ||
    isDescendantOf(symbol.bindingIdentifier, containingLoop)
  ) {
    return null;
  }
  symbols.add(symbol);
  const initializer = stripParenExpression(symbol.initializer);
  if (isNodeOfType(initializer, "ArrayExpression")) return symbol;
  return collectStableOrigin(initializer, containingLoop, symbols, scopes);
};

const getDirectEvalScopes = (scopes: ScopeAnalysis): ScopeDescriptor[] => {
  const cachedScopes = directEvalScopesByAnalysis.get(scopes);
  if (cachedScopes) return cachedScopes;
  const evalScopes: ScopeDescriptor[] = [];
  walkAst(scopes.rootScope.node, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "eval" &&
      scopes.isGlobalReference(node.callee)
    ) {
      evalScopes.push(scopes.scopeFor(node.callee));
    }
  });
  directEvalScopesByAnalysis.set(scopes, evalScopes);
  return evalScopes;
};

const hasReachableDirectEval = (originSymbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  for (const evalScope of getDirectEvalScopes(scopes)) {
    let currentScope: ScopeDescriptor | null = evalScope;
    while (currentScope) {
      if (currentScope === originSymbol.scope) return true;
      currentScope = currentScope.parent;
    }
  }
  return false;
};

const isGlobalIdentifier = (expression: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(expression, "Identifier") &&
  expression.name === name &&
  scopes.isGlobalReference(expression);

const isGlobalObjectExpression = (
  expression: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<SymbolDescriptor>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isGlobalIdentifier(strippedExpression, name, scopes)) return true;
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(strippedExpression);
    if (!symbol?.initializer || symbol.kind !== "const" || visitedSymbols.has(symbol)) return false;
    const bindingProperty = symbol.bindingIdentifier.parent;
    const bindingPattern = bindingProperty?.parent;
    const declarator = bindingPattern?.parent;
    if (
      bindingProperty &&
      isNodeOfType(bindingProperty, "Property") &&
      bindingPattern &&
      isNodeOfType(bindingPattern, "ObjectPattern") &&
      declarator &&
      isNodeOfType(declarator, "VariableDeclarator") &&
      declarator.init
    ) {
      const propertyName = isNodeOfType(bindingProperty.key, "Identifier")
        ? bindingProperty.key.name
        : isNodeOfType(bindingProperty.key, "Literal") &&
            typeof bindingProperty.key.value === "string"
          ? bindingProperty.key.value
          : null;
      if (
        propertyName === name &&
        isGlobalObjectExpression(declarator.init, "globalThis", scopes, visitedSymbols)
      ) {
        return true;
      }
    }
    visitedSymbols.add(symbol);
    return isGlobalObjectExpression(symbol.initializer, name, scopes, visitedSymbols);
  }
  return (
    isNodeOfType(strippedExpression, "MemberExpression") &&
    getStaticPropertyName(strippedExpression) === name &&
    isGlobalObjectExpression(strippedExpression.object, "globalThis", scopes, visitedSymbols)
  );
};

const isArrayPrototypeExpression = (
  expression: EsTreeNode,
  prototypeAliases: Set<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(strippedExpression);
    if (!symbol) return false;
    if (prototypeAliases.has(symbol)) return true;
    const bindingProperty = symbol.bindingIdentifier.parent;
    const bindingPattern = bindingProperty?.parent;
    const declarator = bindingPattern?.parent;
    return Boolean(
      bindingProperty &&
      isNodeOfType(bindingProperty, "Property") &&
      ((isNodeOfType(bindingProperty.key, "Identifier") &&
        bindingProperty.key.name === "prototype") ||
        (isNodeOfType(bindingProperty.key, "Literal") &&
          bindingProperty.key.value === "prototype")) &&
      bindingPattern &&
      isNodeOfType(bindingPattern, "ObjectPattern") &&
      declarator &&
      isNodeOfType(declarator, "VariableDeclarator") &&
      declarator.init &&
      isGlobalObjectExpression(declarator.init, "Array", scopes),
    );
  }
  if (
    isNodeOfType(strippedExpression, "MemberExpression") &&
    getStaticPropertyName(strippedExpression) === "__proto__" &&
    isNodeOfType(stripParenExpression(strippedExpression.object), "ArrayExpression")
  ) {
    return true;
  }
  if (isNodeOfType(strippedExpression, "CallExpression")) {
    const apiKey = getGlobalMutationApiKey(strippedExpression.callee, scopes);
    const argument = strippedExpression.arguments[0];
    return Boolean(
      (apiKey === "Object.getPrototypeOf" || apiKey === "Reflect.getPrototypeOf") &&
      argument &&
      !isNodeOfType(argument, "SpreadElement") &&
      isNodeOfType(stripParenExpression(argument), "ArrayExpression"),
    );
  }
  return (
    isNodeOfType(strippedExpression, "MemberExpression") &&
    getStaticPropertyName(strippedExpression) === "prototype" &&
    isGlobalObjectExpression(strippedExpression.object, "Array", scopes)
  );
};

const getGlobalMutationApiKey = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<SymbolDescriptor>(),
): string | null => {
  const strippedCallee = stripParenExpression(callee);
  if (isNodeOfType(strippedCallee, "Identifier")) {
    const symbol = scopes.symbolFor(strippedCallee);
    if (!symbol || visitedSymbols.has(symbol)) return null;
    const bindingProperty = symbol.bindingIdentifier.parent;
    const bindingPattern = bindingProperty?.parent;
    const declarator = bindingPattern?.parent;
    if (
      bindingProperty &&
      isNodeOfType(bindingProperty, "Property") &&
      bindingPattern &&
      isNodeOfType(bindingPattern, "ObjectPattern") &&
      declarator &&
      isNodeOfType(declarator, "VariableDeclarator") &&
      declarator.init
    ) {
      const methodName = isNodeOfType(bindingProperty.key, "Identifier")
        ? bindingProperty.key.name
        : isNodeOfType(bindingProperty.key, "Literal") &&
            typeof bindingProperty.key.value === "string"
          ? bindingProperty.key.value
          : null;
      if (methodName && isGlobalObjectExpression(declarator.init, "Object", scopes)) {
        return `Object.${methodName}`;
      }
      if (methodName && isGlobalObjectExpression(declarator.init, "Reflect", scopes)) {
        return `Reflect.${methodName}`;
      }
    }
    if (!symbol.initializer || symbol.kind !== "const") return null;
    visitedSymbols.add(symbol);
    return getGlobalMutationApiKey(symbol.initializer, scopes, visitedSymbols);
  }
  if (!isNodeOfType(strippedCallee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(strippedCallee);
  if (!methodName) return null;
  if (isGlobalObjectExpression(strippedCallee.object, "Object", scopes)) {
    return `Object.${methodName}`;
  }
  if (isGlobalObjectExpression(strippedCallee.object, "Reflect", scopes)) {
    return `Reflect.${methodName}`;
  }
  return null;
};

const objectExpressionCanDefineMethod = (expression: EsTreeNode, methodName: string): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (!isNodeOfType(strippedExpression, "ObjectExpression")) return true;
  return strippedExpression.properties.some((property) => {
    if (isNodeOfType(property, "SpreadElement")) return true;
    if (!isNodeOfType(property, "Property")) return false;
    if (property.computed && !isNodeOfType(property.key, "Literal")) return true;
    return (
      (isNodeOfType(property.key, "Identifier") && property.key.name === methodName) ||
      (isNodeOfType(property.key, "Literal") && property.key.value === methodName)
    );
  });
};

const hasArrayPrototypeMethodMutation = (scopes: ScopeAnalysis, methodName: string): boolean => {
  const cachedMutation = arrayPrototypeMutationByAnalysis.get(scopes)?.get(methodName);
  if (cachedMutation !== undefined) return cachedMutation;
  const aliasDeclarators: EsTreeNodeOfType<"VariableDeclarator">[] = [];
  walkAst(scopes.rootScope.node, (node) => {
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      node.init
    ) {
      aliasDeclarators.push(node);
    }
  });
  const prototypeAliases = new Set<SymbolDescriptor>();
  let didAddAlias = true;
  while (didAddAlias) {
    didAddAlias = false;
    for (const declarator of aliasDeclarators) {
      if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) continue;
      const aliasSymbol = scopes.symbolFor(declarator.id);
      if (
        aliasSymbol &&
        !prototypeAliases.has(aliasSymbol) &&
        isArrayPrototypeExpression(declarator.init, prototypeAliases, scopes)
      ) {
        prototypeAliases.add(aliasSymbol);
        didAddAlias = true;
      }
    }
  }
  let didMutateMethod = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (didMutateMethod) return false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      isArrayPrototypeExpression(node.object, prototypeAliases, scopes) &&
      isWriteTarget(node) &&
      (getStaticPropertyName(node) === methodName || getStaticPropertyName(node) === null)
    ) {
      didMutateMethod = true;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const mutationApiKey = getGlobalMutationApiKey(node.callee, scopes);
    const mutationTarget = node.arguments[0];
    const mutationDetail = node.arguments[1];
    if (
      mutationTarget &&
      mutationDetail &&
      !isNodeOfType(mutationTarget, "SpreadElement") &&
      !isNodeOfType(mutationDetail, "SpreadElement") &&
      isArrayPrototypeExpression(mutationTarget, prototypeAliases, scopes) &&
      (((mutationApiKey === "Object.defineProperty" ||
        mutationApiKey === "Reflect.defineProperty" ||
        mutationApiKey === "Reflect.set" ||
        mutationApiKey === "Reflect.deleteProperty") &&
        (!isNodeOfType(mutationDetail, "Literal") || mutationDetail.value === methodName)) ||
        ((mutationApiKey === "Object.assign" || mutationApiKey === "Object.defineProperties") &&
          objectExpressionCanDefineMethod(mutationDetail, methodName)))
    ) {
      didMutateMethod = true;
      return false;
    }
  });
  let mutationsByMethod = arrayPrototypeMutationByAnalysis.get(scopes);
  if (!mutationsByMethod) {
    mutationsByMethod = new Map();
    arrayPrototypeMutationByAnalysis.set(scopes, mutationsByMethod);
  }
  mutationsByMethod.set(methodName, didMutateMethod);
  return didMutateMethod;
};

export const hasUnmodifiedArrayPrototypeMethod = (
  scopes: ScopeAnalysis,
  methodName: string,
): boolean => !hasArrayPrototypeMethodMutation(scopes, methodName);

const hasOnlySafeReferences = (
  originSymbol: SymbolDescriptor,
  initialSymbols: Set<SymbolDescriptor>,
  allowedMethodNames: ReadonlySet<string>,
  requiredPrototypeMethodName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (hasReachableDirectEval(originSymbol, scopes)) return false;
  if (hasArrayPrototypeMethodMutation(scopes, requiredPrototypeMethodName)) return false;
  const symbols = new Set(initialSymbols);
  const pendingSymbols = [...symbols];
  while (pendingSymbols.length > 0) {
    const symbol = pendingSymbols.pop();
    if (!symbol) continue;
    for (const reference of symbol.references) {
      const node = reference.identifier;
      const aliasSymbol = getDirectConstAliasSymbol(node, scopes);
      if (
        aliasSymbol &&
        !isExportedBinding(aliasSymbol.bindingIdentifier) &&
        !symbols.has(aliasSymbol)
      ) {
        symbols.add(aliasSymbol);
        pendingSymbols.push(aliasSymbol);
      }
      if (!isSafeBindingReference(node, allowedMethodNames, scopes)) return false;
    }
  }
  return true;
};

export const isStableLocalArrayLookupReceiver = (
  receiver: EsTreeNode,
  containingLoop: EsTreeNode,
  scopes: ScopeAnalysis,
  allowedMethodNames: ReadonlySet<string> = DEFAULT_ALLOWED_ARRAY_METHOD_NAMES,
  requiredPrototypeMethodName = "includes",
): boolean => {
  const symbols = new Set<SymbolDescriptor>();
  const originSymbol = collectStableOrigin(receiver, containingLoop, symbols, scopes);
  if (!originSymbol) return false;
  const cachedStability = stabilityByOriginBinding
    .get(originSymbol.bindingIdentifier)
    ?.get(requiredPrototypeMethodName)
    ?.get(allowedMethodNames);
  if (cachedStability !== undefined) return cachedStability;
  const isStable = hasOnlySafeReferences(
    originSymbol,
    symbols,
    allowedMethodNames,
    requiredPrototypeMethodName,
    scopes,
  );
  let stabilityByMethod = stabilityByOriginBinding.get(originSymbol.bindingIdentifier);
  if (!stabilityByMethod) {
    stabilityByMethod = new Map();
    stabilityByOriginBinding.set(originSymbol.bindingIdentifier, stabilityByMethod);
  }
  let stabilityByAllowedMethods = stabilityByMethod.get(requiredPrototypeMethodName);
  if (!stabilityByAllowedMethods) {
    stabilityByAllowedMethods = new Map();
    stabilityByMethod.set(requiredPrototypeMethodName, stabilityByAllowedMethods);
  }
  stabilityByAllowedMethods.set(allowedMethodNames, isStable);
  return isStable;
};
