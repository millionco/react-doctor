import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { MAX_RESOURCE_KEY_FACTORY_DEPTH } from "./constants.js";
import { hasClosedResourceKeyProgram } from "./has-closed-resource-key-program.js";
import { isLocalResourceKeyRenderFrame } from "./is-local-resource-key-render-frame.js";
import { isResourceKeyRenderedChild } from "./is-resource-key-rendered-child.js";

interface ResourceKeyArrayOrigin {
  readonly description: string | null;
}

const isDirectCallReference = (node: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  const call = root.parent;
  return Boolean(
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.callee === root &&
    !call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")),
  );
};

const getObjectKeyDescription = (
  object: EsTreeNode,
  keyName: string,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(object, "ObjectExpression")) return null;
  const names = object.properties.map((property) => getStaticPropertyKeyName(property));
  if (
    names.some((name) => name === null || name === "__proto__") ||
    new Set(names).size !== names.length ||
    object.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") || property.kind !== "init" || property.method,
    )
  )
    return null;
  const property = object.properties.find(
    (candidate) => getStaticPropertyKeyName(candidate) === keyName,
  );
  if (!isNodeOfType(property, "Property")) return null;
  const value = stripParenExpression(property.value);
  if (
    !isNodeOfType(value, "CallExpression") ||
    value.optional ||
    value.arguments.length ||
    !isNodeOfType(value.callee, "Identifier")
  )
    return null;
  const symbol = context.scopes.symbolFor(value.callee);
  if (!symbol) return null;
  const declaration = getImportDeclarationForSymbol(symbol);
  if (
    !declaration ||
    isTypeOnlyImport(declaration) ||
    declaration.source.value !== "uuid" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    getImportedName(symbol.declarationNode) !== "v4" ||
    !symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        isDirectCallReference(reference.identifier),
    )
  )
    return null;
  return `${value.callee.name}()`;
};

const getArrayOrigin = (
  array: EsTreeNode,
  keyName: string,
  context: RuleContext,
): ResourceKeyArrayOrigin | null => {
  if (!isNodeOfType(array, "ArrayExpression")) return null;
  let description: string | null = null;
  for (const element of array.elements) {
    if (!element) return null;
    const itemDescription = getObjectKeyDescription(
      stripParenExpression(element),
      keyName,
      context,
    );
    if (!itemDescription) return null;
    description ??= itemDescription;
  }
  return { description };
};

const isOwnReturnReference = (node: EsTreeNode, frame: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  return (
    isNodeOfType(root.parent, "ReturnStatement") &&
    root.parent.argument === root &&
    findEnclosingFunction(root.parent) === frame
  );
};

const getFactoryOrigin = (
  call: EsTreeNode,
  keyName: string,
  context: RuleContext,
  depth: number,
  visitedSymbols: ReadonlySet<number>,
): ResourceKeyArrayOrigin | null => {
  if (
    depth >= MAX_RESOURCE_KEY_FACTORY_DEPTH ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return null;
  const symbol = context.scopes.symbolFor(call.callee);
  if (!symbol || visitedSymbols.has(symbol.id)) return null;
  const initializer = getDirectConstInitializer(symbol);
  const factory = initializer ? stripParenExpression(initializer) : null;
  if (
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    factory.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    !symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        isDirectCallReference(reference.identifier),
    )
  )
    return null;
  if (symbol.references.some((reference) => isAstDescendant(reference.identifier, factory)))
    return null;
  let hasUnsupportedLocalCall = false;
  walkAst(factory, (node: EsTreeNode) => {
    if (hasUnsupportedLocalCall) return false;
    if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier")) return;
    const calleeSymbol = context.scopes.symbolFor(node.callee);
    if (!calleeSymbol || calleeSymbol.kind === "import") return;
    const root = findTransparentExpressionRoot(node);
    if (
      findEnclosingFunction(node) === factory &&
      (isOwnReturnReference(node, factory) || factory.body === root)
    )
      return;
    const declarator = root.parent;
    if (
      findEnclosingFunction(node) === factory &&
      isNodeOfType(declarator, "VariableDeclarator") &&
      declarator.init === root &&
      isNodeOfType(declarator.id, "Identifier")
    ) {
      const resultSymbol = context.scopes.symbolFor(declarator.id);
      if (
        resultSymbol &&
        getDirectConstInitializer(resultSymbol) === root &&
        resultSymbol.references.length &&
        resultSymbol.references.every(
          (reference) =>
            reference.flag === "read" &&
            !isWithinAssignmentTarget(reference.identifier) &&
            isOwnReturnReference(reference.identifier, factory),
        )
      )
        return;
    }
    hasUnsupportedLocalCall = true;
    return false;
  });
  if (hasUnsupportedLocalCall) return null;
  const nextVisited = new Set(visitedSymbols).add(symbol.id);
  const expressions = isNodeOfType(factory.body, "BlockStatement")
    ? collectFunctionReturnStatements(factory)
        .filter((statement) => isNodeReachableWithinFunction(statement, context))
        .map((statement) => statement.argument)
    : [factory.body];
  if (!expressions.length) return null;
  let description: string | null = null;
  for (const expression of expressions) {
    if (!expression) return null;
    const origin = getReturnedOrigin(expression, factory, keyName, context, depth, nextVisited);
    if (!origin) return null;
    description ??= origin.description;
  }
  return { description };
};

const getReturnedOrigin = (
  expression: EsTreeNode,
  frame: EsTreeNode,
  keyName: string,
  context: RuleContext,
  depth: number,
  visitedSymbols: ReadonlySet<number>,
): ResourceKeyArrayOrigin | null => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "ArrayExpression")) return getArrayOrigin(value, keyName, context);
  if (isNodeOfType(value, "CallExpression"))
    return getFactoryOrigin(value, keyName, context, depth + 1, visitedSymbols);
  if (!isNodeOfType(value, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(value);
  if (!symbol || findEnclosingFunction(symbol.declarationNode) !== frame) return null;
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return null;
  const source = stripParenExpression(initializer);
  if (isNodeOfType(source, "CallExpression")) {
    if (
      !symbol.references.every(
        (reference) =>
          reference.flag === "read" &&
          !isWithinAssignmentTarget(reference.identifier) &&
          isOwnReturnReference(reference.identifier, frame),
      )
    )
      return null;
    return getFactoryOrigin(source, keyName, context, depth + 1, visitedSymbols);
  }
  let origin = getArrayOrigin(source, keyName, context);
  if (!origin) return null;
  for (const reference of symbol.references) {
    if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return null;
    if (isOwnReturnReference(reference.identifier, frame)) continue;
    const receiver = findTransparentExpressionRoot(reference.identifier);
    const member = receiver.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== receiver ||
      member.computed ||
      member.optional ||
      getStaticPropertyName(member) !== "push"
    )
      return null;
    const call = findTransparentExpressionRoot(member).parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== findTransparentExpressionRoot(member) ||
      findEnclosingFunction(call) !== frame ||
      !call.arguments.length
    )
      return null;
    if (!isNodeReachableWithinFunction(call, context)) continue;
    for (const argument of call.arguments) {
      const description = getObjectKeyDescription(stripParenExpression(argument), keyName, context);
      if (!description) return null;
      origin = { description: origin.description ?? description };
    }
  }
  return origin;
};

export const getLocalResourceKeyFreshDescription = (
  expression: EsTreeNode,
  context: RuleContext,
): string | null => {
  const key = stripParenExpression(expression);
  if (
    !isNodeOfType(key, "MemberExpression") ||
    key.computed ||
    key.optional ||
    !isNodeOfType(key.object, "Identifier") ||
    !hasClosedResourceKeyProgram(context.scopes) ||
    !isNodeReachableWithinFunction(key, context)
  )
    return null;
  const keyName = getStaticPropertyName(key);
  const callback = findEnclosingFunction(key);
  if (!keyName || !isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return null;
  const container = findTransparentExpressionRoot(key).parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  const element = opening?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    attribute.value !== container ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(element, "JSXElement") ||
    !isResourceKeyRenderedChild(element, callback, context)
  )
    return null;
  const [parameter, ...otherParameters] = callback.params;
  if (otherParameters.length || !isNodeOfType(parameter, "Identifier")) return null;
  const itemSymbol = context.scopes.symbolFor(parameter);
  if (!itemSymbol || context.scopes.symbolFor(key.object) !== itemSymbol) return null;
  if (
    !itemSymbol.references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      const member = root.parent;
      if (!isNodeOfType(member, "MemberExpression")) return false;
      const consumer = findTransparentExpressionRoot(member).parent;
      return (
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        member.object === root &&
        !member.computed &&
        !member.optional &&
        !(
          isNodeOfType(consumer, "CallExpression") &&
          consumer.callee === findTransparentExpressionRoot(member)
        )
      );
    })
  )
    return null;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const mapCall = callbackRoot.parent;
  if (
    !isNodeOfType(mapCall, "CallExpression") ||
    mapCall.optional ||
    mapCall.arguments.length !== callback.params.length ||
    mapCall.arguments[0] !== callbackRoot
  )
    return null;
  const mapMember = stripParenExpression(mapCall.callee);
  if (
    !isNodeOfType(mapMember, "MemberExpression") ||
    mapMember.computed ||
    mapMember.optional ||
    getStaticPropertyName(mapMember) !== "map" ||
    !isNodeOfType(mapMember.object, "Identifier")
  )
    return null;
  const frame = findEnclosingFunction(mapCall);
  if (
    !isNodeOfType(frame, "ArrowFunctionExpression") ||
    !isLocalResourceKeyRenderFrame(frame, mapCall, context) ||
    !isNodeReachableWithinFunction(mapCall, context)
  )
    return null;
  const listSymbol = context.scopes.symbolFor(mapMember.object);
  if (
    !listSymbol ||
    findEnclosingFunction(listSymbol.declarationNode) !== frame ||
    !isNodeOfType(listSymbol.declarationNode, "VariableDeclarator") ||
    listSymbol.declarationNode.parent?.parent !== frame.body ||
    getNodeStartIndex(listSymbol.declarationNode) >= getNodeStartIndex(mapCall) ||
    !isNodeReachableWithinFunction(listSymbol.declarationNode, context) ||
    !listSymbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        reference.identifier === mapMember.object,
    )
  )
    return null;
  const initializer = getDirectConstInitializer(listSymbol);
  if (!initializer) return null;
  return (
    getFactoryOrigin(stripParenExpression(initializer), keyName, context, 0, new Set())
      ?.description ?? null
  );
};
