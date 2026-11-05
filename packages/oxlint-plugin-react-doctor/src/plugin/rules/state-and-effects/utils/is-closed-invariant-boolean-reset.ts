import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface ClosedInvariantBooleanResetInput {
  context: RuleContext;
  owner: EsTreeNode;
  effectCall: EsTreeNode;
  effectFunction: EsTreeNode;
  setterCall: EsTreeNode | null;
}

const isDirectReactApi = (
  invocation: EsTreeNode,
  apiName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(invocation, "CallExpression") || invocation.optional) return false;
  if (!isNodeOfType(invocation.callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(invocation.callee);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    !isSymbolReadOnly(symbol)
  )
    return false;
  const origin = resolveImportedApiReference(invocation.callee, context.scopes);
  return origin?.source === "react" && origin.importedName === apiName;
};

export const isClosedInvariantBooleanReset = ({
  context,
  owner,
  effectCall,
  effectFunction,
  setterCall,
}: ClosedInvariantBooleanResetInput): boolean => {
  if (
    !(
      isNodeOfType(owner, "ArrowFunctionExpression") ||
      isNodeOfType(owner, "FunctionExpression") ||
      isNodeOfType(owner, "FunctionDeclaration")
    ) ||
    owner.async ||
    owner.generator ||
    owner.params.length !== 1 ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.body.body.length !== 3
  )
    return false;
  const parameter = owner.params[0];
  if (!isNodeOfType(parameter, "Identifier")) {
    if (
      !isNodeOfType(parameter, "ObjectPattern") ||
      !parameter.properties.every(
        (property) =>
          isNodeOfType(property, "Property") &&
          !property.computed &&
          isNodeOfType(property.key, "Identifier") &&
          isNodeOfType(property.value, "Identifier"),
      )
    )
      return false;
  }
  if (
    !isNodeOfType(setterCall, "CallExpression") ||
    setterCall.optional ||
    !isNodeOfType(setterCall.callee, "Identifier") ||
    setterCall.arguments.length !== 1 ||
    !isNodeOfType(setterCall.arguments[0], "Literal") ||
    typeof setterCall.arguments[0].value !== "boolean" ||
    !isDirectReactApi(effectCall, "useEffect", context) ||
    !isNodeOfType(effectCall, "CallExpression") ||
    effectCall.arguments.length !== 2 ||
    effectCall.arguments[0] !== effectFunction ||
    !isNodeOfType(effectCall.arguments[1], "ArrayExpression") ||
    !effectCall.arguments[1].elements.every(
      (dependency) =>
        isNodeOfType(dependency, "Identifier") && Boolean(context.scopes.referenceFor(dependency)),
    ) ||
    !(
      isNodeOfType(effectFunction, "ArrowFunctionExpression") ||
      isNodeOfType(effectFunction, "FunctionExpression")
    ) ||
    effectFunction.async ||
    effectFunction.generator ||
    effectFunction.params.length !== 0 ||
    !isNodeOfType(effectFunction.body, "BlockStatement") ||
    effectFunction.body.body.length !== 1
  )
    return false;
  const pair = resolveReactUseStatePair(setterCall.callee, context.scopes);
  if (
    !pair ||
    !pair.stateSymbol ||
    context.scopes.symbolFor(setterCall.callee) !== pair.setterSymbol
  )
    return false;
  const { declarator, stateSymbol, setterSymbol } = pair;
  const declaration = declarator.parent;
  const effectStatement = owner.body.body[1];
  const returnStatement = owner.body.body[2];
  if (
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== 2 ||
    !isNodeOfType(declarator.id.elements[0], "Identifier") ||
    !isNodeOfType(declarator.id.elements[1], "Identifier") ||
    stateSymbol.bindingIdentifier !== declarator.id.elements[0] ||
    setterSymbol.bindingIdentifier !== declarator.id.elements[1] ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    declaration !== owner.body.body[0] ||
    !isNodeOfType(effectStatement, "ExpressionStatement") ||
    effectStatement.expression !== effectCall ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !isNodeOfType(returnStatement.argument, "JSXElement") ||
    findEnclosingFunction(effectCall) !== owner ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isDirectReactApi(declarator.init, "useState", context) ||
    declarator.init.arguments.length !== 1 ||
    !isNodeOfType(declarator.init.arguments[0], "Literal") ||
    declarator.init.arguments[0].value !== setterCall.arguments[0].value ||
    !isSymbolReadOnly(stateSymbol) ||
    !isSymbolReadOnly(setterSymbol)
  )
    return false;
  const guard = effectFunction.body.body[0];
  if (!isNodeOfType(guard, "IfStatement") || guard.alternate) return false;
  const initialValue = setterCall.arguments[0].value;
  const test = stripParenExpression(guard.test);
  const stateRead = initialValue
    ? test
    : isNodeOfType(test, "UnaryExpression") && test.operator === "!"
      ? stripParenExpression(test.argument)
      : null;
  if (!isNodeOfType(stateRead, "Identifier") || context.scopes.symbolFor(stateRead) !== stateSymbol)
    return false;
  const consequent = isNodeOfType(guard.consequent, "BlockStatement")
    ? guard.consequent.body.length === 1
      ? guard.consequent.body[0]
      : null
    : guard.consequent;
  if (!isNodeOfType(consequent, "ExpressionStatement") || consequent.expression !== setterCall)
    return false;
  const setterReferences = setterSymbol.references.filter(
    (reference) => !isTypeScriptTypePosition(reference.identifier),
  );
  if (setterReferences.length !== 1 || setterReferences[0]?.identifier !== setterCall.callee)
    return false;
  const element = returnStatement.argument;
  if (
    !isNodeOfType(element.openingElement.name, "JSXIdentifier") ||
    !/^[a-z][a-z0-9]*$/.test(element.openingElement.name.name) ||
    element.openingElement.attributes.length !== 0
  )
    return false;
  const children = element.children.filter(
    (child) => !isNodeOfType(child, "JSXText") || child.value.trim() !== "",
  );
  if (
    children.length !== 1 ||
    !isNodeOfType(children[0], "JSXExpressionContainer") ||
    !isNodeOfType(children[0].expression, "ConditionalExpression")
  )
    return false;
  const visible = children[0].expression;
  if (
    !isNodeOfType(visible.test, "Identifier") ||
    context.scopes.symbolFor(visible.test) !== stateSymbol ||
    ![visible.consequent, visible.alternate].every(
      (branch) =>
        isNodeOfType(branch, "Literal") &&
        (branch.value === null || ["string", "number", "boolean"].includes(typeof branch.value)),
    )
  )
    return false;
  let componentDeclaration: EsTreeNode = owner;
  if (!isNodeOfType(owner, "FunctionDeclaration")) {
    const componentDeclarator = owner.parent;
    if (
      !isNodeOfType(componentDeclarator, "VariableDeclarator") ||
      componentDeclarator.init !== owner ||
      !isNodeOfType(componentDeclarator.id, "Identifier") ||
      !isNodeOfType(componentDeclarator.parent, "VariableDeclaration") ||
      componentDeclarator.parent.kind !== "const" ||
      componentDeclarator.parent.declarations.length !== 1
    )
      return false;
    componentDeclaration = componentDeclarator.parent;
  }
  if (
    isNodeOfType(componentDeclaration.parent, "ExportNamedDeclaration") ||
    isNodeOfType(componentDeclaration.parent, "ExportDefaultDeclaration")
  ) {
    if (componentDeclaration.parent.declaration !== componentDeclaration) return false;
    componentDeclaration = componentDeclaration.parent;
  }
  const program = componentDeclaration.parent;
  if (!isNodeOfType(program, "Program")) return false;
  for (const statement of program.body) {
    if (
      statement === componentDeclaration ||
      isNodeOfType(statement, "TSInterfaceDeclaration") ||
      isNodeOfType(statement, "TSTypeAliasDeclaration")
    )
      continue;
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      isNodeOfType(statement.expression, "Literal") &&
      typeof statement.expression.value === "string" &&
      ["use client", "use strict"].includes(statement.expression.value)
    )
      continue;
    if (!isNodeOfType(statement, "ImportDeclaration")) return false;
    if (statement.importKind === "type") continue;
    if (
      statement.specifiers.length > 0 &&
      statement.specifiers.every(
        (specifier) =>
          isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type",
      )
    )
      continue;
    if (statement.source.value !== "react" || statement.specifiers.length === 0) return false;
    for (const specifier of statement.specifiers) {
      if (!isNodeOfType(specifier, "ImportSpecifier")) return false;
      if (specifier.importKind === "type") continue;
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol || !isSymbolReadOnly(symbol)) return false;
    }
  }
  return true;
};
