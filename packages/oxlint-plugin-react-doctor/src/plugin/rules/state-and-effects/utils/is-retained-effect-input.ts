import { REACT_RUNTIME_MODULE_SOURCES } from "../../../constants/react.js";
import type { ScopeAnalysis, ScopeDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasEnclosingTypeParameterNamed } from "../../../utils/has-enclosing-type-parameter-named.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const getExpressionStatementValue = (node: EsTreeNode | undefined): EsTreeNode | undefined =>
  isNodeOfType(node, "ExpressionStatement") ? stripParenExpression(node.expression) : undefined;

const isNamedReactHook = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const symbol = resolveConstIdentifierAlias(stripParenExpression(node.callee), scopes);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return false;
  const imported = resolveImportedApiReference(node.callee, scopes);
  return imported?.importedName === name && REACT_RUNTIME_MODULE_SOURCES.has(imported.source);
};

const getGuardedEffectWrite = (write: EsTreeNode, context: RuleContext) => {
  const callback = findEnclosingFunction(write);
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    ("generator" in callback && callback.generator) ||
    callback.params.length !== 0
  ) {
    return null;
  }
  const root = findTransparentExpressionRoot(callback);
  const effect = root.parent;
  const ownerBody = effect?.parent?.parent;
  const owner = ownerBody?.parent;
  if (
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments.length !== 2 ||
    effect.arguments[0] !== root ||
    getExpressionStatementValue(effect.parent ?? undefined) !== effect ||
    !isNodeOfType(ownerBody, "BlockStatement") ||
    !isFunctionLike(owner) ||
    owner.body !== ownerBody ||
    !isNamedReactHook(effect, "useEffect", context.scopes) ||
    !isNodeReachableWithinFunction(effect, context)
  ) {
    return null;
  }
  const dependencies = stripParenExpression(effect.arguments[1]);
  if (!isNodeOfType(dependencies, "ArrayExpression") || dependencies.elements.length !== 1) {
    return null;
  }
  const dependencyNode = dependencies.elements[0];
  if (!dependencyNode || !isNodeOfType(stripParenExpression(dependencyNode), "Identifier")) {
    return null;
  }
  const dependency = context.scopes.symbolFor(stripParenExpression(dependencyNode));
  if (
    dependency?.kind !== "parameter" ||
    dependency.scope.node !== owner ||
    dependency.references.some(({ flag }) => flag !== "read")
  ) {
    return null;
  }
  const statements = getCallbackStatements(callback);
  const conditional = statements[0];
  if (
    statements.length !== 1 ||
    !isNodeOfType(conditional, "IfStatement") ||
    conditional.alternate
  ) {
    return null;
  }
  const branch = conditional.consequent;
  const body = isNodeOfType(branch, "BlockStatement") ? branch.body : [branch];
  return body.length === 1 && getExpressionStatementValue(body[0]) === write
    ? { effect, owner, dependency, test: stripParenExpression(conditional.test) }
    : null;
};

const isClearedValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const value = stripParenExpression(node);
  return (
    (isNodeOfType(value, "Literal") && value.value === null) ||
    (isNodeOfType(value, "Identifier") &&
      value.name === "undefined" &&
      scopes.isGlobalReference(value))
  );
};

interface InputTruthiness {
  canBeTruthy: boolean;
  canBeFalsy: boolean;
}

const getInputTruthiness = (
  type: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedAliases = new Set<EsTreeNode>(),
): InputTruthiness | null => {
  if (isNodeOfType(type, "TSUnionType")) {
    const alternatives = type.types.map((member) =>
      getInputTruthiness(member, scopes, visitedAliases),
    );
    if (alternatives.some((alternative) => !alternative)) return null;
    return {
      canBeTruthy: alternatives.some((alternative) => alternative?.canBeTruthy),
      canBeFalsy: alternatives.some((alternative) => alternative?.canBeFalsy),
    };
  }
  if (isNodeOfType(type, "TSLiteralType") && isNodeOfType(type.literal, "Literal")) {
    return { canBeTruthy: Boolean(type.literal.value), canBeFalsy: !type.literal.value };
  }
  if (
    isNodeOfType(type, "TSNullKeyword") ||
    isNodeOfType(type, "TSUndefinedKeyword") ||
    isNodeOfType(type, "TSVoidKeyword") ||
    isNodeOfType(type, "TSNeverKeyword")
  ) {
    return { canBeTruthy: false, canBeFalsy: !isNodeOfType(type, "TSNeverKeyword") };
  }
  if (
    isNodeOfType(type, "TSStringKeyword") ||
    isNodeOfType(type, "TSNumberKeyword") ||
    isNodeOfType(type, "TSBooleanKeyword") ||
    isNodeOfType(type, "TSBigIntKeyword") ||
    isNodeOfType(type, "TSAnyKeyword") ||
    isNodeOfType(type, "TSUnknownKeyword")
  ) {
    return { canBeTruthy: true, canBeFalsy: true };
  }
  if (
    !isNodeOfType(type, "TSTypeReference") ||
    !isNodeOfType(type.typeName, "Identifier") ||
    type.typeArguments ||
    hasEnclosingTypeParameterNamed(type, type.typeName.name)
  ) {
    return null;
  }
  for (let scope: ScopeDescriptor | null = scopes.scopeFor(type); scope; scope = scope.parent) {
    const symbol = scope.symbolsByName.get(type.typeName.name);
    if (!symbol) continue;
    // An imported domain can supply a present value. Require the parameter
    // itself to allow omission when the type cannot prove an absent value.
    if (symbol.kind === "import") return { canBeTruthy: true, canBeFalsy: false };
    const alias = symbol.declarationNode;
    if (
      !isNodeOfType(alias, "TSTypeAliasDeclaration") ||
      alias.typeParameters ||
      visitedAliases.has(alias)
    ) {
      return null;
    }
    return getInputTruthiness(alias.typeAnnotation, scopes, new Set([...visitedAliases, alias]));
  }
  return null;
};

// The first effect leaves the previous value intact when its input goes
// missing. A separate input schedules the clear, so reading the current
// input during render can't recover the stored value.
export const isRetainedEffectInput = (
  effect: EsTreeNode,
  write: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(write, "CallExpression") ||
    write.optional ||
    write.arguments.length !== 1 ||
    !isNodeOfType(write.callee, "Identifier")
  ) {
    return false;
  }
  const input = stripParenExpression(write.arguments[0]);
  if (!isNodeOfType(input, "Identifier")) return false;
  const scopes = context.scopes;
  const copy = getGuardedEffectWrite(write, context);
  if (
    !copy ||
    copy.effect !== effect ||
    !isNodeOfType(copy.test, "Identifier") ||
    scopes.symbolFor(copy.test) !== copy.dependency ||
    scopes.symbolFor(input) !== copy.dependency
  ) {
    return false;
  }
  const inputType = getSymbolTypeAnnotation(copy.dependency);
  const inputBinding = copy.dependency.bindingIdentifier;
  const truthiness = inputType
    ? getInputTruthiness(inputType, scopes)
    : { canBeTruthy: true, canBeFalsy: true };
  if (
    isNodeOfType(inputBinding.parent, "AssignmentPattern") ||
    isNodeOfType(inputBinding.parent, "RestElement") ||
    !truthiness?.canBeTruthy ||
    (!truthiness.canBeFalsy && !(isNodeOfType(inputBinding, "Identifier") && inputBinding.optional))
  ) {
    return false;
  }

  const pair = resolveReactUseStatePair(write.callee, scopes);
  if (
    !pair ||
    scopes.symbolFor(write.callee) !== pair.setterSymbol ||
    pair.setterSymbol.kind !== "const" ||
    pair.stateSymbol?.kind !== "const" ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    pair.declarator.init.arguments.length !== 1 ||
    scopes.symbolFor(stripParenExpression(pair.declarator.init.arguments[0])) !== copy.dependency ||
    findEnclosingFunction(pair.declarator) !== copy.owner ||
    !isNamedReactHook(pair.declarator.init, "useState", scopes) ||
    !hasCompleteSymbolReferences(pair.setterSymbol, scopes.rootScope.node, scopes)
  ) {
    return false;
  }
  const setterUses = pair.setterSymbol.references.filter(
    ({ identifier }) => identifier !== pair.setterSymbol.bindingIdentifier,
  );
  if (
    setterUses.length !== 2 ||
    !setterUses.some(({ identifier }) => identifier === write.callee) ||
    setterUses.some(({ flag }) => flag !== "read")
  ) {
    return false;
  }
  const otherSetter = setterUses.find(({ identifier }) => identifier !== write.callee)?.identifier;
  const reset = otherSetter?.parent;
  if (
    !isNodeOfType(reset, "CallExpression") ||
    reset.optional ||
    reset.callee !== otherSetter ||
    reset.arguments.length !== 1 ||
    !isClearedValue(reset.arguments[0], scopes)
  ) {
    return false;
  }
  const clear = getGuardedEffectWrite(reset, context);
  if (
    !clear ||
    clear.owner !== copy.owner ||
    clear.effect === effect ||
    clear.dependency === copy.dependency ||
    !isNodeOfType(clear.test, "BinaryExpression") ||
    clear.test.operator !== "==="
  ) {
    return false;
  }

  const left = stripParenExpression(clear.test.left);
  const right = stripParenExpression(clear.test.right);
  const [compared, literal] = isNodeOfType(left, "Literal") ? [right, left] : [left, right];
  if (
    !isNodeOfType(compared, "Identifier") ||
    scopes.symbolFor(compared) !== clear.dependency ||
    !isNodeOfType(literal, "Literal") ||
    typeof literal.value !== "string"
  ) {
    return false;
  }

  let hasEval = false;
  walkAst(copy.owner, (node) => {
    if (hasEval) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "eval" &&
      scopes.isGlobalReference(node)
    ) {
      hasEval = true;
      return false;
    }
  });
  return !hasEval;
};
