import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getNodeEndIndex } from "../../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";
import { GUARD_OBJECT_PUBLICATION_RUNTIME_TYPES } from "./guard-object-publication-runtime-types.js";

export const awaitedCallbacksMayPublishGuardObject = (
  statements: ReadonlyArray<EsTreeNode>,
  guard: EsTreeNodeOfType<"IfStatement">,
  context: RuleContext,
): boolean => {
  const owner = findEnclosingFunction(guard);
  if (!isFunctionLike(owner)) return false;
  let supportsLexicalProof = true;
  walkAst(owner.body, (node) => {
    if (!supportsLexicalProof) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      GUARD_OBJECT_PUBLICATION_RUNTIME_TYPES.has(node.type) ||
      (isNodeOfType(node, "TSEnumDeclaration") && !node.declare) ||
      (isNodeOfType(node, "TSModuleDeclaration") && !node.declare) ||
      (isNodeOfType(node, "TSImportEqualsDeclaration") && node.importKind !== "type")
    ) {
      supportsLexicalProof = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== "eval" ||
      !context.scopes.referenceFor(node)
    )
      return;
    const symbol = context.scopes.symbolFor(node);
    const declaration = symbol && getImportDeclarationForSymbol(symbol);
    if (
      context.scopes.isGlobalReference(node) ||
      symbol?.kind === "ts-interface" ||
      symbol?.kind === "ts-type-alias" ||
      (declaration &&
        symbol &&
        (isTypeOnlyImport(declaration) ||
          (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
            symbol.declarationNode.importKind === "type")))
    )
      supportsLexicalProof = false;
  });
  if (!supportsLexicalProof) return false;
  const resolveOwnConst = (identifier: EsTreeNode, before: EsTreeNode): SymbolDescriptor | null => {
    if (!isNodeOfType(identifier, "Identifier")) return null;
    const symbol = context.scopes.symbolFor(identifier);
    if (
      !symbol ||
      !getDirectConstInitializer(symbol) ||
      findEnclosingFunction(symbol.declarationNode) !== owner ||
      getNodeStartIndex(before) < 0 ||
      getNodeEndIndex(symbol.declarationNode) < 0 ||
      getNodeEndIndex(symbol.declarationNode) >= getNodeStartIndex(before)
    )
      return null;
    if (
      symbol.references.some((reference) => {
        if (reference.flag !== "read") return true;
        const root = findTransparentExpressionRoot(reference.identifier);
        const consumer = root.parent;
        return (
          isWithinAssignmentTarget(root) &&
          (!isNodeOfType(consumer, "MemberExpression") || consumer.object !== root)
        );
      })
    )
      return null;
    return symbol;
  };
  const guardProperties = new Map<SymbolDescriptor, Set<string>>();
  const firstAwait = statements[0];
  if (!firstAwait) return false;
  walkAst(guard.test, (node) => {
    if (isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "MemberExpression") || node.optional || isWithinAssignmentTarget(node))
      return;
    const propertyName = getStaticPropertyName(node);
    const symbol = resolveOwnConst(stripParenExpression(node.object), firstAwait);
    const initializer = symbol && getDirectConstInitializer(symbol);
    if (
      !propertyName ||
      !symbol ||
      !isNodeOfType(initializer, "ObjectExpression") ||
      initializer.properties.length !== 0
    )
      return;
    const properties = guardProperties.get(symbol) ?? new Set<string>();
    properties.add(propertyName);
    guardProperties.set(symbol, properties);
  });
  if (guardProperties.size === 0) return false;
  const resolveCallback = (expression: EsTreeNode, call: EsTreeNode): EsTreeNode | null => {
    const value = stripParenExpression(expression);
    if (isFunctionLike(value)) return value.generator ? null : value;
    const symbol = resolveOwnConst(value, call);
    const initializer = symbol && getDirectConstInitializer(symbol);
    const callback = initializer && stripParenExpression(initializer);
    return isFunctionLike(callback) && !callback.generator ? callback : null;
  };
  const mayPublish = (callback: EsTreeNode): boolean => {
    let publishes = false;
    walkOwnFunctionScope(callback, (node) => {
      if (publishes) return false;
      if (isTypeScriptTypePosition(node)) return false;
      if (!isNodeOfType(node, "Identifier")) return;
      const symbol = context.scopes.symbolFor(node);
      const properties = symbol && guardProperties.get(symbol);
      if (!properties || !isNodeReachableWithinFunction(node, context)) return;
      const root = findTransparentExpressionRoot(node);
      const consumer = root.parent;
      if (
        (isNodeOfType(consumer, "CallExpression") &&
          !consumer.optional &&
          consumer.arguments.some((argument) => argument === root)) ||
        (isNodeOfType(consumer, "JSXExpressionContainer") &&
          consumer.expression === root &&
          isNodeOfType(consumer.parent, "JSXAttribute"))
      ) {
        publishes = true;
        return false;
      }
      if (
        !isNodeOfType(consumer, "MemberExpression") ||
        consumer.object !== root ||
        consumer.optional
      )
        return;
      const propertyName = getStaticPropertyName(consumer);
      if (!propertyName || !properties.has(propertyName)) return;
      const member = findTransparentExpressionRoot(consumer);
      const write = member.parent;
      if (
        (isNodeOfType(write, "AssignmentExpression") && write.left === member) ||
        (isNodeOfType(write, "UpdateExpression") && write.argument === member)
      )
        publishes = true;
    });
    return publishes;
  };
  for (const statement of statements) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declaration of statement.declarations) {
      if (!declaration.init) continue;
      const awaited = stripParenExpression(declaration.init);
      if (!isNodeOfType(awaited, "AwaitExpression")) continue;
      const call = stripParenExpression(awaited.argument);
      if (!isNodeOfType(call, "CallExpression") || call.optional) continue;
      for (const argument of call.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        const direct = resolveCallback(argument, call);
        if (direct && mayPublish(direct)) return true;
        const options = stripParenExpression(argument);
        if (!isNodeOfType(options, "ObjectExpression")) continue;
        const names = new Set<string>();
        let supportsOptions = true;
        for (const property of options.properties) {
          if (isNodeOfType(property, "SpreadElement")) {
            if (isNodeOfType(stripParenExpression(property.argument), "ObjectExpression")) {
              supportsOptions = false;
              break;
            }
            continue;
          }
          const name = getStaticPropertyKeyName(property, { allowComputedString: true });
          if (
            !isNodeOfType(property, "Property") ||
            property.computed ||
            property.method ||
            property.kind !== "init" ||
            name === null ||
            names.has(name)
          ) {
            supportsOptions = false;
            break;
          }
          names.add(name);
        }
        if (!supportsOptions) continue;
        for (const property of options.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          const callback = resolveCallback(property.value, call);
          if (callback && mayPublish(callback)) return true;
        }
      }
    }
  }
  return false;
};
