import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const stockEffectName = (raw: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const node = stripParenExpression(raw);
  const receiver = isNodeOfType(node, "MemberExpression") ? node.object : node;
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const symbol = scopes.symbolFor(receiver);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !isSymbolReadOnly(symbol) ||
    !declaration ||
    declaration.importKind === "type" ||
    declaration.source.value !== "react" ||
    declaration.attributes?.length
  )
    return null;
  let name: string | null = null;
  if (isNodeOfType(node, "MemberExpression")) {
    if (
      node.optional ||
      node.computed ||
      !isNodeOfType(node.property, "Identifier") ||
      (!isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
        !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"))
    )
      return null;
    name = node.property.name;
  } else if (
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    symbol.declarationNode.importKind !== "type"
  ) {
    name = getImportedName(symbol.declarationNode) ?? null;
  }
  return name === "useEffect" || name === "useLayoutEffect" ? name : null;
};

const isIsomorphicEffectChoice = (raw: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const node = stripParenExpression(raw);
  if (!isNodeOfType(node, "ConditionalExpression")) return false;
  const test = stripParenExpression(node.test);
  return (
    isNodeOfType(test, "BinaryExpression") &&
    test.operator === "!==" &&
    isNodeOfType(test.left, "UnaryExpression") &&
    test.left.operator === "typeof" &&
    isNodeOfType(test.left.argument, "Identifier") &&
    test.left.argument.name === "window" &&
    scopes.isGlobalReference(test.left.argument) &&
    isNodeOfType(test.right, "Literal") &&
    test.right.value === "undefined" &&
    stockEffectName(node.consequent, scopes) === "useLayoutEffect" &&
    stockEffectName(node.alternate, scopes) === "useEffect"
  );
};

const isClosedEffectChoiceUse = (raw: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const root = findTransparentExpressionRoot(raw);
  const choice = root.parent;
  if (!isNodeOfType(choice, "ConditionalExpression") || !isIsomorphicEffectChoice(choice, scopes))
    return false;
  const declaration = findTransparentExpressionRoot(choice).parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    isNodeOfType(declaration.parent?.parent, "ExportNamedDeclaration")
  )
    return false;
  const binding = scopes.symbolFor(declaration.id);
  return Boolean(
    binding?.kind === "const" &&
    isSymbolReadOnly(binding) &&
    hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes) &&
    binding.references.length > 0 &&
    binding.references.every(({ identifier }) => {
      const callee = findTransparentExpressionRoot(identifier);
      return (
        isNodeOfType(callee.parent, "CallExpression") &&
        !callee.parent.optional &&
        callee.parent.callee === callee
      );
    }),
  );
};

const hasClosedReactProviders = (scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(scopes.rootScope.node, "Program")) return false;
  return scopes.rootScope.node.body.every((statement) => {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.source.value !== "react" ||
      statement.importKind === "type"
    )
      return true;
    if (statement.attributes?.length || statement.specifiers.length === 0) return false;
    return statement.specifiers.every((specifier) => {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
        return true;
      const binding = scopes.symbolFor(specifier.local);
      if (
        !binding ||
        !isSymbolReadOnly(binding) ||
        !hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes)
      )
        return false;
      return binding.references.every(({ identifier, flag }) => {
        if (isTypeScriptTypePosition(identifier)) return true;
        if (flag !== "read" || isWithinAssignmentTarget(identifier)) return false;
        let value = findTransparentExpressionRoot(identifier);
        if (isNodeOfType(specifier, "ImportSpecifier")) {
          const name = getImportedName(specifier);
          if (!name || !/^use[A-Z]/.test(name)) return false;
        } else {
          const member = value.parent;
          if (
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== value ||
            member.computed ||
            member.optional ||
            !isNodeOfType(member.property, "Identifier") ||
            !/^use[A-Z]/.test(member.property.name)
          )
            return false;
          value = findTransparentExpressionRoot(member);
        }
        return (
          (isNodeOfType(value.parent, "CallExpression") &&
            !value.parent.optional &&
            value.parent.callee === value) ||
          isClosedEffectChoiceUse(value, scopes)
        );
      });
    });
  });
};

export const isClosedReactMediaEffect = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): callback is EsTreeNodeOfType<"ArrowFunctionExpression"> => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length
  )
    return false;
  const root = findTransparentExpressionRoot(callback);
  const call = root.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments[0] !== root ||
    call.arguments.length !== 2 ||
    !isNodeOfType(call.arguments[1], "ArrayExpression") ||
    !hasClosedReactProviders(scopes)
  )
    return false;
  if (stockEffectName(call.callee, scopes)) return true;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = scopes.symbolFor(callee);
  const initializer = binding && getDirectConstInitializer(binding);
  return Boolean(
    binding &&
    isSymbolReadOnly(binding) &&
    initializer &&
    isIsomorphicEffectChoice(initializer, scopes) &&
    findEnclosingFunction(binding.declarationNode) === findEnclosingFunction(call),
  );
};

export const isPlainMediaListenerCall = (
  method: string,
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  const modern = method === "addEventListener" || method === "removeEventListener";
  if (
    (!modern && method !== "addListener" && method !== "removeListener") ||
    call.optional ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    call.arguments.length !== (modern ? 2 : 1) ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;
  if (
    modern &&
    (!isNodeOfType(call.arguments[0], "Literal") || call.arguments[0].value !== "change")
  )
    return false;
  const handler = call.arguments[modern ? 1 : 0];
  if (!isNodeOfType(handler, "Identifier")) return false;
  const binding = scopes.symbolFor(handler);
  const initializer = binding && getDirectConstInitializer(binding);
  return Boolean(
    binding &&
    isSymbolReadOnly(binding) &&
    hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes) &&
    isNodeOfType(initializer, "ArrowFunctionExpression") &&
    !initializer.async &&
    initializer.params.length === 0,
  );
};
