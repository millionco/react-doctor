import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { TRANSPARENT_EXPRESSION_WRAPPER_TYPES } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";
import {
  PRIVATE_LATCH_EFFECT_ARGUMENT_COUNT,
  PRIVATE_LATCH_EFFECT_PARAMETER_COUNT,
  PRIVATE_LATCH_INITIALIZER_ARGUMENT_COUNT,
  PRIVATE_LATCH_REFERENCE_COUNT,
  PRIVATE_LATCH_SETTER_INDEX,
  PRIVATE_LATCH_STATE_INDEX,
  PRIVATE_LATCH_TUPLE_LENGTH,
  PRIVATE_LATCH_UNSUPPORTED_GLOBAL_NAMES,
  PRIVATE_LATCH_UNSUPPORTED_PROGRAM_NODE_TYPES,
  PRIVATE_LATCH_UNSUPPORTED_PROPERTY_NAMES,
} from "./private-initialization-latch/constants.js";

const supportedProgramsByScopes = new WeakMap<ScopeAnalysis, boolean>();
const closedOwners = new WeakMap<EsTreeNode, boolean>();

const isDirectReactValueCall = (
  node: EsTreeNode,
  apiName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = node.callee;
  const receiver =
    isNodeOfType(callee, "MemberExpression") && !callee.optional ? callee.object : callee;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  const api = resolveImportedApiReference(callee, context.scopes);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    api?.source === "react" &&
    api.importedName === apiName,
  );
};

const hasClosedReactProvider = (symbol: SymbolDescriptor): boolean => {
  const namespace =
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    getImportedName(symbol.declarationNode) === "default";
  return symbol.references.every((reference) => {
    if (reference.flag !== "read") return false;
    const root = findTransparentExpressionRoot(reference.identifier);
    if (namespace) {
      const member = root.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== root ||
        member.optional ||
        member.computed
      )
        return false;
      const memberRoot = findTransparentExpressionRoot(member);
      return (
        isNodeOfType(memberRoot.parent, "CallExpression") &&
        memberRoot.parent.callee === memberRoot &&
        !memberRoot.parent.optional
      );
    }
    return (
      isNodeOfType(root.parent, "CallExpression") &&
      root.parent.callee === root &&
      !root.parent.optional
    );
  });
};

const hasSupportedLatchProgram = (context: RuleContext): boolean => {
  const cached = supportedProgramsByScopes.get(context.scopes);
  if (cached !== undefined) return cached;
  for (const symbol of context.scopes.rootScope.symbols) {
    if (getValueImportSource(symbol) !== "react") continue;
    if (!hasClosedReactProvider(symbol)) {
      supportedProgramsByScopes.set(context.scopes, false);
      return false;
    }
  }
  let supported = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (
      ("declare" in node && node.declare === true) ||
      PRIVATE_LATCH_UNSUPPORTED_PROGRAM_NODE_TYPES.has(node.type)
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      node.type.startsWith("TS") &&
      !TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(node.type) &&
      !isNodeOfType(node, "TSTypeAliasDeclaration") &&
      !isNodeOfType(node, "TSInterfaceDeclaration")
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier")) {
      const reference = context.scopes.referenceFor(node);
      if (!reference) return;
      const symbol = reference.resolvedSymbol;
      if (
        symbol?.kind === "ts-interface" ||
        symbol?.kind === "ts-type-alias" ||
        (symbol?.kind === "import" && getValueImportSource(symbol) === null) ||
        (PRIVATE_LATCH_UNSUPPORTED_GLOBAL_NAMES.has(node.name) &&
          (node.name === "eval" || node.name === "Function" || !symbol))
      )
        supported = false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, context.scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (propertyName === null || PRIVATE_LATCH_UNSUPPORTED_PROPERTY_NAMES.has(propertyName))
        supported = false;
    }
  });
  supportedProgramsByScopes.set(context.scopes, supported);
  return supported;
};

export const isPrivateInitializationLatchWrite = (
  write: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(write, "CallExpression") ||
    write.optional ||
    !isNodeOfType(write.callee, "Identifier") ||
    !isNodeOfType(write.parent, "ExpressionStatement") ||
    write.arguments.length !== PRIVATE_LATCH_INITIALIZER_ARGUMENT_COUNT ||
    readStaticBoolean(write.arguments[PRIVATE_LATCH_STATE_INDEX]) !== false
  )
    return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  if (
    !pair?.stateSymbol ||
    !isNodeOfType(pair.declarator.id, "ArrayPattern") ||
    pair.declarator.id.elements.length !== PRIVATE_LATCH_TUPLE_LENGTH ||
    !isNodeOfType(pair.declarator.id.elements[PRIVATE_LATCH_STATE_INDEX], "Identifier") ||
    !isNodeOfType(pair.declarator.id.elements[PRIVATE_LATCH_SETTER_INDEX], "Identifier") ||
    !isNodeOfType(pair.declarator.parent, "VariableDeclaration") ||
    pair.declarator.parent.kind !== "const" ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    pair.declarator.init.arguments.length !== PRIVATE_LATCH_INITIALIZER_ARGUMENT_COUNT ||
    readStaticBoolean(pair.declarator.init.arguments[PRIVATE_LATCH_STATE_INDEX]) !== true ||
    !isDirectReactValueCall(pair.declarator.init, "useState", context)
  )
    return false;
  const state = pair.stateSymbol;
  const setter = pair.setterSymbol;
  if (
    context.scopes.symbolFor(write.callee) !== setter ||
    state.references.length !== PRIVATE_LATCH_REFERENCE_COUNT ||
    setter.references.length !== PRIVATE_LATCH_REFERENCE_COUNT
  )
    return false;
  const stateReference = state.references[PRIVATE_LATCH_STATE_INDEX];
  const setterReference = setter.references[PRIVATE_LATCH_STATE_INDEX];
  if (
    !stateReference ||
    !setterReference ||
    stateReference.flag !== "read" ||
    setterReference.flag !== "read" ||
    setterReference.identifier !== write.callee
  )
    return false;
  const stateRoot = findTransparentExpressionRoot(stateReference.identifier);
  const guard = stateRoot.parent;
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.test !== stateRoot ||
    !isAstDescendant(write, guard.consequent)
  )
    return false;
  const callback = findEnclosingFunction(write);
  const owner = findEnclosingFunction(pair.declarator);
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== PRIVATE_LATCH_EFFECT_PARAMETER_COUNT ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    !owner ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    findEnclosingFunction(stateReference.identifier) !== callback
  )
    return false;
  const effect = callback.parent;
  if (
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments.length !== PRIVATE_LATCH_EFFECT_ARGUMENT_COUNT ||
    effect.arguments[PRIVATE_LATCH_STATE_INDEX] !== callback ||
    !isDirectReactValueCall(effect, "useEffect", context) ||
    findEnclosingFunction(effect) !== owner
  )
    return false;
  let closedOwner = closedOwners.get(owner);
  if (closedOwner === undefined) {
    closedOwner = true;
    walkOwnFunctionScope(owner, (node) => {
      if (isNodeOfType(node, "ReturnStatement") && node.argument) closedOwner = false;
    });
    closedOwners.set(owner, closedOwner);
  }
  let closedBranch = true;
  walkAst(guard.consequent, (node) => {
    if (
      isFunctionLike(node) ||
      isNodeOfType(node, "AwaitExpression") ||
      isNodeOfType(node, "YieldExpression") ||
      (isNodeOfType(node, "CallExpression") && node !== write)
    )
      closedBranch = false;
    if (
      isNodeOfType(node, "Identifier") &&
      context.scopes.referenceFor(node) &&
      node !== write.callee
    ) {
      const symbol = context.scopes.symbolFor(node);
      if (
        resolveReactUseStatePair(node, context.scopes) ||
        symbol?.kind === "function" ||
        (symbol?.initializer && isFunctionLike(symbol.initializer))
      )
        closedBranch = false;
    }
  });
  if (!closedOwner || !closedBranch) return false;
  return hasSupportedLatchProgram(context);
};
