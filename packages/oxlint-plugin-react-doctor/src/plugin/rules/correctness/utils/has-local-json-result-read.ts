import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const isSimpleDestructure = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ArrayPattern")) {
    return node.elements.every(
      (element) => element === null || isNodeOfType(element, "Identifier"),
    );
  }
  return (
    isNodeOfType(node, "ObjectPattern") &&
    node.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        property.kind === "init" &&
        !property.method &&
        isNodeOfType(property.value, "Identifier"),
    )
  );
};

export const hasLocalJsonResultRead = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    call.optional ||
    call.arguments.length !== 1 ||
    isNodeOfType(call.arguments[0], "SpreadElement")
  )
    return false;
  let initializer = findTransparentExpressionRoot(call);
  const conditional = initializer.parent;
  if (isNodeOfType(conditional, "ConditionalExpression")) {
    const condition = stripParenExpression(conditional.test);
    if (!isNodeOfType(condition, "Identifier")) return false;
    const conditionSymbol = scopes.symbolFor(condition);
    if (
      !conditionSymbol ||
      !conditionSymbol.references.every((reference) => reference.flag === "read")
    )
      return false;
    if (conditionSymbol.kind !== "parameter" && conditionSymbol.kind !== "catch-clause-parameter") {
      if (
        conditionSymbol.kind !== "const" &&
        conditionSymbol.kind !== "let" &&
        conditionSymbol.kind !== "var"
      )
        return false;
      const conditionDeclaration = conditionSymbol.bindingIdentifier.parent;
      if (
        !isNodeOfType(conditionDeclaration, "VariableDeclarator") ||
        conditionDeclaration.id !== conditionSymbol.bindingIdentifier ||
        !conditionDeclaration.init ||
        conditionDeclaration.range[1] > call.range[0]
      )
        return false;
      const conditionInitializer = stripParenExpression(conditionDeclaration.init);
      if (
        !isNodeOfType(conditionInitializer, "CallExpression") &&
        (!isNodeOfType(conditionInitializer, "AwaitExpression") ||
          !isNodeOfType(stripParenExpression(conditionInitializer.argument), "CallExpression"))
      )
        return false;
    }
    if (conditional.consequent !== initializer && conditional.alternate !== initializer)
      return false;
    const fallback = stripParenExpression(
      conditional.consequent === initializer ? conditional.alternate : conditional.consequent,
    );
    if (!isNodeOfType(fallback, "ObjectExpression") || fallback.properties.length !== 0)
      return false;
    initializer = findTransparentExpressionRoot(conditional);
  }
  const declarator = initializer.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== initializer ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return false;
  const declaration = declarator.parent;
  const block = declaration?.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    (!isNodeOfType(block, "BlockStatement") && !isNodeOfType(block, "Program"))
  )
    return false;
  const symbol = scopes.symbolFor(declarator.id);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    symbol.bindingIdentifier !== declarator.id ||
    symbol.references.length === 0
  )
    return false;
  const owner = findEnclosingFunction(call);
  const isSelectedIdentifier = (expression: EsTreeNode): boolean => {
    const identifier = stripParenExpression(expression);
    return isNodeOfType(identifier, "Identifier") && scopes.symbolFor(identifier) === symbol;
  };
  const isMemberRead = (expression: EsTreeNode): boolean => {
    let current = stripParenExpression(expression);
    if (isNodeOfType(current, "CallExpression")) {
      if (current.optional) return false;
      current = stripParenExpression(current.callee);
    }
    if (!isNodeOfType(current, "MemberExpression")) return false;
    while (isNodeOfType(current, "MemberExpression")) {
      if (current.optional || getStaticPropertyName(current) === null) return false;
      current = stripParenExpression(current.object);
    }
    return isSelectedIdentifier(current);
  };
  const isDestructureRead = (expression: EsTreeNode): boolean => {
    const root = findTransparentExpressionRoot(expression);
    const parent = root.parent;
    return (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === root &&
      isSimpleDestructure(parent.id)
    );
  };
  if (
    !symbol.references.every((reference) => {
      if (reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== owner)
        return false;
      const expression = findTransparentExpressionRoot(reference.identifier);
      const parent = expression.parent;
      return (
        isDestructureRead(expression) ||
        (isNodeOfType(parent, "MemberExpression") &&
          parent.object === expression &&
          !parent.optional &&
          getStaticPropertyName(parent) !== null &&
          !isWithinAssignmentTarget(parent))
      );
    })
  )
    return false;
  const statementIndex = block.body.findIndex((statement) => statement === declaration);
  const next = block.body[statementIndex + 1];
  if (statementIndex < 0 || !next) return false;
  if (isNodeOfType(next, "VariableDeclaration") && next.declarations.length === 1) {
    const selected = next.declarations[0];
    if (!selected?.init) return false;
    return (
      isMemberRead(selected.init) ||
      (isSelectedIdentifier(selected.init) && isSimpleDestructure(selected.id))
    );
  }
  if (isNodeOfType(next, "ReturnStatement") && next.argument) return isMemberRead(next.argument);
  if (isNodeOfType(next, "IfStatement")) return isMemberRead(next.test);
  return isNodeOfType(next, "ExpressionStatement") && isMemberRead(next.expression);
};
