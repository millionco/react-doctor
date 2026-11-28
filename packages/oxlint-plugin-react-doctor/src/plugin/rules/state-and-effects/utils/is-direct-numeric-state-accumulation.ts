import { HTML_TAGS } from "../../../constants/html-tags.js";
import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getRuntimeStaticDependencySource } from "../../../utils/get-runtime-static-dependency-source.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { statementAlwaysExits } from "../../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EffectStateWriteFact } from "./collect-effect-state-write-facts.js";

const reactObjectAccessByScope = new WeakMap<ScopeAnalysis, boolean>();

const hasReactObjectAccess = (scopes: ScopeAnalysis): boolean => {
  const cached = reactObjectAccessByScope.get(scopes);
  if (cached !== undefined) return cached;
  let hasAccess = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasAccess) return false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      getRuntimeStaticDependencySource(node) === "react"
    ) {
      hasAccess = node.specifiers.some((specifier) => {
        if (
          isNodeOfType(specifier, "ImportSpecifier") &&
          (specifier.importKind === "type" || getImportedName(specifier) !== "default")
        )
          return false;
        return (
          scopes
            .symbolFor(specifier.local)
            ?.references.some(({ identifier }) => !isTypeScriptTypePosition(identifier)) ?? false
        );
      });
    } else if (
      isNodeOfType(node, "Identifier") &&
      (node.name === "require" || node.name === "module")
    ) {
      hasAccess = scopes.referenceFor(node)?.resolvedSymbol === null;
    } else if (isNodeOfType(node, "ImportExpression")) {
      const source = stripParenExpression(node.source);
      hasAccess = !isNodeOfType(source, "Literal") || source.value === "react";
    } else if (
      isNodeOfType(node, "TSImportEqualsDeclaration") &&
      node.importKind !== "type" &&
      isNodeOfType(node.moduleReference, "TSExternalModuleReference")
    ) {
      hasAccess = node.moduleReference.expression.value === "react";
    }
  });
  reactObjectAccessByScope.set(scopes, hasAccess);
  return hasAccess;
};

const getNamedReactImport = (expression: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  if (!isNodeOfType(symbol?.declarationNode, "ImportSpecifier")) return null;
  const provider = resolveImportedApiReference(expression, scopes);
  return provider?.source === "react" ? provider.importedName : null;
};

const isReachableInFunctionBody = (statement: EsTreeNode, owner: EsTreeNode): boolean => {
  const block = statement.parent;
  if (!isFunctionLike(owner) || owner.body !== block || !isNodeOfType(block, "BlockStatement")) {
    return false;
  }
  for (const preceding of block.body) {
    if (preceding === statement) return true;
    if (statementAlwaysExits(preceding)) return false;
  }
  return false;
};

const isReturnedStateValue = (identifier: EsTreeNode, owner: EsTreeNode): boolean => {
  let value = findTransparentExpressionRoot(identifier);
  if (isNodeOfType(value.parent, "JSXExpressionContainer")) {
    value = value.parent;
    while (isNodeOfType(value.parent, "JSXElement") || isNodeOfType(value.parent, "JSXFragment")) {
      const parent: EsTreeNode = value.parent;
      if (isNodeOfType(parent, "JSXElement")) {
        const { name, attributes } = parent.openingElement;
        if (
          !isNodeOfType(name, "JSXIdentifier") ||
          !HTML_TAGS.has(name.name) ||
          name.name === "template" ||
          attributes.length > 0
        )
          return false;
      }
      value = parent;
    }
    if (isNodeOfType(value, "JSXExpressionContainer")) return false;
    value = findTransparentExpressionRoot(value);
  }
  return (
    isNodeOfType(value.parent, "ReturnStatement") && isReachableInFunctionBody(value.parent, owner)
  );
};

const getEffectLocalValue = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
): EsTreeNode => {
  let current = stripParenExpression(expression);
  const visited = new Set<EsTreeNode>();
  while (isNodeOfType(current, "Identifier") && !visited.has(current)) {
    visited.add(current);
    const symbol = context.scopes.symbolFor(current);
    if (!symbol || symbol.references.some(({ flag }) => flag !== "read")) break;
    const initializer = getDirectConstInitializer(symbol);
    if (
      !initializer ||
      findEnclosingFunction(initializer) !== callback ||
      !nodeDominatesNode(initializer, current, context)
    )
      break;
    current = stripParenExpression(initializer);
  }
  return current;
};

const readFiniteLiteral = (expression: EsTreeNode | undefined): number | null => {
  if (!expression) return null;
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal") && typeof value.value === "number") {
    return Number.isFinite(value.value) ? value.value : null;
  }
  if (
    isNodeOfType(value, "UnaryExpression") &&
    (value.operator === "+" || value.operator === "-")
  ) {
    const operand = stripParenExpression(value.argument);
    if (
      isNodeOfType(operand, "Literal") &&
      typeof operand.value === "number" &&
      Number.isFinite(operand.value)
    ) {
      return value.operator === "-" ? -operand.value : operand.value;
    }
  }
  return null;
};

const canApplyNumericStep = (
  expression: EsTreeNode,
  dependencies: EsTreeNode,
  owner: EsTreeNode,
  advancesState: (amount: number) => boolean,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(expression, "ConditionalExpression") ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 1
  ) {
    return false;
  }
  const test = stripParenExpression(expression.test);
  const [dependency] = dependencies.elements;
  const condition = isNodeOfType(test, "Identifier") ? scopes.symbolFor(test) : null;
  if (
    condition?.kind !== "parameter" ||
    findEnclosingFunction(condition.bindingIdentifier) !== owner ||
    condition.references.some(({ flag }) => flag !== "read") ||
    !isNodeOfType(dependency, "Identifier") ||
    scopes.symbolFor(dependency) !== condition
  )
    return false;
  const consequent = readFiniteLiteral(expression.consequent);
  const alternate = readFiniteLiteral(expression.alternate);
  return (
    consequent !== null &&
    alternate !== null &&
    advancesState(consequent) &&
    advancesState(alternate)
  );
};

export const isDirectNumericStateAccumulation = (
  context: RuleContext,
  effect: EsTreeNode,
  fact: EffectStateWriteFact,
): boolean => {
  const call = fact.callExpression;
  if (
    fact.isDeferred ||
    fact.isForwardedWrite ||
    !isNodeOfType(effect, "CallExpression") ||
    effect.optional ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.arguments.length !== 1
  )
    return false;
  const [argument] = call.arguments;
  if (!argument || isNodeOfType(argument, "SpreadElement")) return false;
  const [callbackExpression, dependencies] = effect.arguments;
  const callback = callbackExpression ? stripParenExpression(callbackExpression) : null;
  if (
    effect.arguments.length !== 2 ||
    !dependencies ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    (callback.body !== call &&
      (!isNodeOfType(call.parent, "ExpressionStatement") ||
        !isReachableInFunctionBody(call.parent, callback)))
  )
    return false;
  const write = getEffectLocalValue(argument, callback, context);
  if (
    !isNodeOfType(write, "BinaryExpression") ||
    (write.operator !== "+" && write.operator !== "-")
  ) {
    return false;
  }
  const effectName = getNamedReactImport(effect.callee, context.scopes);
  const owner = findEnclosingFunction(effect);
  if (
    !effectName ||
    !EFFECT_HOOK_NAMES.has(effectName) ||
    !owner ||
    !isNodeOfType(effect.parent, "ExpressionStatement") ||
    !isReachableInFunctionBody(effect.parent, owner)
  )
    return false;
  const pair = resolveReactUseStatePair(call.callee, context.scopes);
  if (
    !pair?.stateSymbol ||
    pair.declarator !== fact.stateDeclarator ||
    !pair.declarator.parent ||
    !isReachableInFunctionBody(pair.declarator.parent, owner) ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    pair.declarator.init.optional ||
    pair.declarator.init.arguments.length !== 1
  )
    return false;
  const seed = readFiniteLiteral(pair.declarator.init.arguments[0]);
  if (seed === null) return false;
  if (getNamedReactImport(pair.declarator.init.callee, context.scopes) !== "useState") return false;

  const left = getEffectLocalValue(write.left, callback, context);
  const right = getEffectLocalValue(write.right, callback, context);
  const consumesState = (candidate: EsTreeNode) =>
    isNodeOfType(candidate, "Identifier") &&
    context.scopes.symbolFor(candidate) === pair.stateSymbol;
  const readsStateOnLeft = consumesState(left);
  if (!readsStateOnLeft && (write.operator === "-" || !consumesState(right))) return false;
  const step = readsStateOnLeft ? right : left;
  const advancesState = (amount: number): boolean => {
    const result = write.operator === "+" ? seed + amount : seed - amount;
    return Number.isFinite(result) && result !== seed;
  };
  if (!canApplyNumericStep(step, dependencies, owner, advancesState, context.scopes)) return false;

  const root = context.scopes.rootScope.node;
  const setter = pair.setterSymbol;
  const [use] = setter.references;
  return (
    setter.references.length === 1 &&
    use?.identifier === call.callee &&
    use.flag === "read" &&
    pair.stateSymbol.references.every(({ flag }) => flag === "read") &&
    pair.stateSymbol.references.some(({ identifier }) => isReturnedStateValue(identifier, owner)) &&
    hasCompleteSymbolReferences(setter, root, context.scopes) &&
    hasCompleteSymbolReferences(pair.stateSymbol, root, context.scopes) &&
    !hasReactObjectAccess(context.scopes)
  );
};
