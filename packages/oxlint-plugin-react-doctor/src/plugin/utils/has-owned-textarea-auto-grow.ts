import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { HTML_TAGS } from "../constants/html-tags.js";
import { getInlineStyleExpression } from "../rules/design/utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "../rules/design/utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "../rules/design/utils/get-style-property-key.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { findJsxAttribute } from "./find-jsx-attribute.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

const getAttributeExpression = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  name: string,
): EsTreeNode | null => {
  const attribute = findJsxAttribute(node.attributes, name);
  return attribute?.value && isNodeOfType(attribute.value, "JSXExpressionContainer")
    ? stripParenExpression(attribute.value.expression)
    : null;
};

const isLiteralValue = (node: EsTreeNode | null | undefined, value: string | null): boolean =>
  Boolean(node && isNodeOfType(node, "Literal") && node.value === value);

const isSymbol = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;

const isRuntimeReactNamedCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  importedName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier") || node.optional) return false;
  const symbol = scopes.symbolFor(callee);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === importedName &&
    symbol.references.every((reference) => reference.flag === "read"),
  );
};

const isMemberOf = (
  node: EsTreeNode,
  property: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.optional &&
  getStaticPropertyName(node) === property;

const isCurrentRef = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isMemberOf(node, "current") && isSymbol(node.object, symbol, scopes);

const isRefHeight = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isMemberOf(node, "height") &&
  isMemberOf(node.object, "style") &&
  isCurrentRef(node.object.object, symbol, scopes);

const isScrollHeight = (
  node: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => isMemberOf(node, "scrollHeight") && isCurrentRef(node.object, symbol, scopes);

const isPixelScrollHeight = (
  node: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(node, "BinaryExpression") && node.operator === "+") {
    return isLiteralValue(node.right, "px") && isScrollHeight(node.left, symbol, scopes);
  }
  return (
    isNodeOfType(node, "TemplateLiteral") &&
    node.expressions.length === 1 &&
    node.quasis[0]?.value.cooked === "" &&
    node.quasis[1]?.value.cooked === "px" &&
    isScrollHeight(node.expressions[0], symbol, scopes)
  );
};

const getAssignment = (
  statement: EsTreeNode | undefined,
): EsTreeNodeOfType<"AssignmentExpression"> | null =>
  statement &&
  isNodeOfType(statement, "ExpressionStatement") &&
  isNodeOfType(statement.expression, "AssignmentExpression") &&
  statement.expression.operator === "="
    ? statement.expression
    : null;

const getCall = (statement: EsTreeNode | undefined): EsTreeNodeOfType<"CallExpression"> | null =>
  statement &&
  isNodeOfType(statement, "ExpressionStatement") &&
  isNodeOfType(statement.expression, "CallExpression") &&
  !statement.expression.optional
    ? statement.expression
    : null;

const hasHeightConstraint = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const className = getStringFromClassNameAttr(node);
  if (findJsxAttribute(node.attributes, "className") && className === null) return true;
  const tokens = splitTailwindClassName(className ?? "");
  if (
    tokens
      .map(parseTailwindClassNameToken)
      .some(({ utility }) =>
        /^(?:!?h-|!?max-h-|!?size-|!?\[(?:height|max-height|block-size|max-block-size):)/.test(
          utility,
        ),
      )
  ) {
    return true;
  }
  const style = findJsxAttribute(node.attributes, "style");
  if (!style) return false;
  const expression = getInlineStyleExpression(style);
  return (
    !expression ||
    expression.properties.some((property) => {
      const name = getStylePropertyKey(property);
      return name === null || ["height", "maxHeight", "blockSize", "maxBlockSize"].includes(name);
    })
  );
};

const hasStableNativePlacement = (node: EsTreeNode, component: EsTreeNode): boolean => {
  let current: EsTreeNode | null = node.parent ?? null;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) {
      const opening = current.openingElement;
      if (
        !isNodeOfType(opening.name, "JSXIdentifier") ||
        !HTML_TAGS.has(opening.name.name) ||
        hasHeightConstraint(opening) ||
        opening.attributes.some(
          (attribute) =>
            !isNodeOfType(attribute, "JSXAttribute") ||
            !isNodeOfType(attribute.name, "JSXIdentifier") ||
            ["key", "is", "children", "dangerouslySetInnerHTML"].includes(attribute.name.name) ||
            (opening !== node &&
              (attribute.name.name === "ref" ||
                attribute.name.name === "contentEditable" ||
                (/^on[A-Z]/.test(attribute.name.name) && attribute.name.name !== "onSubmit"))),
        )
      )
        return false;
    } else if (!isNodeOfType(current, "JSXFragment")) return false;
    const root = findTransparentExpressionRoot(current);
    const parent = root.parent;
    if (parent && (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment"))) {
      current = parent;
      continue;
    }
    if (
      parent &&
      isNodeOfType(parent, "ReturnStatement") &&
      parent.argument === root &&
      isFunctionLike(component) &&
      parent.parent === component.body
    ) {
      let hasAlternativeReturn = false;
      walkOwnFunctionScope(component, (child) => {
        if (isNodeOfType(child, "ReturnStatement") && child !== parent) hasAlternativeReturn = true;
      });
      return !hasAlternativeReturn;
    }
    return false;
  }
  return false;
};

export const hasOwnedTextareaAutoGrow = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (hasHeightConstraint(node)) return false;
  const attributeNames = new Set<string>();
  for (const attribute of node.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute") || !isNodeOfType(attribute.name, "JSXIdentifier"))
      return false;
    if (attributeNames.has(attribute.name.name)) return false;
    attributeNames.add(attribute.name.name);
  }
  if (
    node.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        /^on[A-Z]/.test(attribute.name.name) &&
        attribute.name.name !== "onChange",
    )
  )
    return false;
  const ref = getAttributeExpression(node, "ref");
  const value = getAttributeExpression(node, "value");
  const handler = getAttributeExpression(node, "onChange");
  if (!ref || !value || !handler) return false;
  const refSymbol = scopes.symbolFor(ref);
  const valueSymbol = scopes.symbolFor(value);
  const handlerSymbol = scopes.symbolFor(handler);
  if (
    !isNodeOfType(ref, "Identifier") ||
    !isNodeOfType(value, "Identifier") ||
    !isNodeOfType(handler, "Identifier") ||
    !refSymbol ||
    !valueSymbol ||
    !handlerSymbol ||
    refSymbol.kind !== "const" ||
    valueSymbol.kind !== "const" ||
    handlerSymbol.kind !== "const" ||
    !refSymbol.initializer ||
    !handlerSymbol.initializer ||
    !isNodeOfType(refSymbol.declarationNode, "VariableDeclarator") ||
    refSymbol.declarationNode.id !== refSymbol.bindingIdentifier ||
    !isNodeOfType(refSymbol.initializer, "CallExpression") ||
    !isRuntimeReactNamedCall(refSymbol.initializer, "useRef", scopes) ||
    refSymbol.initializer.arguments.length !== 1 ||
    !isLiteralValue(refSymbol.initializer.arguments[0], null) ||
    handlerSymbol.references.some((reference) => reference.identifier !== handler) ||
    refSymbol.references.some((reference) => reference.flag !== "read")
  )
    return false;

  const component = findEnclosingFunction(node);
  if (
    !component ||
    !hasStableNativePlacement(node, component) ||
    findEnclosingFunction(refSymbol.declarationNode) !== component ||
    findEnclosingFunction(handlerSymbol.declarationNode) !== component
  )
    return false;
  if (
    scopes.rootScope.symbols.some(
      (symbol) =>
        getValueImportSource(symbol) === "react" &&
        (getImportedName(symbol.declarationNode) === undefined ||
          getImportedName(symbol.declarationNode) === "default") &&
        symbol.references.length > 0,
    )
  )
    return false;
  const stateDeclaration = valueSymbol.declarationNode;
  if (
    !isNodeOfType(stateDeclaration, "VariableDeclarator") ||
    !isNodeOfType(stateDeclaration.id, "ArrayPattern") ||
    stateDeclaration.id.elements[0] !== valueSymbol.bindingIdentifier ||
    !stateDeclaration.init ||
    !isNodeOfType(stateDeclaration.init, "CallExpression") ||
    !isRuntimeReactNamedCall(stateDeclaration.init, "useState", scopes) ||
    !isLiteralValue(stateDeclaration.init.arguments[0], "") ||
    findEnclosingFunction(stateDeclaration) !== component
  )
    return false;
  const setter = stateDeclaration.id.elements[1];
  const setterSymbol = setter && scopes.symbolFor(setter);
  if (!setterSymbol) return false;

  let callback = stripParenExpression(handlerSymbol.initializer);
  if (
    isNodeOfType(callback, "CallExpression") &&
    isRuntimeReactNamedCall(callback, "useCallback", scopes)
  ) {
    const argument = callback.arguments[0];
    if (!argument) return false;
    callback = stripParenExpression(argument);
  }
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 2 ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier")
  )
    return false;
  const eventSymbol = scopes.symbolFor(callback.params[0]);
  const update = getCall(callback.body.body[0]);
  const guard = callback.body.body[1];
  if (
    !eventSymbol ||
    !update ||
    !isSymbol(update.callee, setterSymbol, scopes) ||
    update.arguments.length !== 1
  )
    return false;
  const inputValue = update.arguments[0];
  if (
    !isMemberOf(inputValue, "value") ||
    !isNodeOfType(inputValue.object, "MemberExpression") ||
    !["target", "currentTarget"].includes(getStaticPropertyName(inputValue.object) ?? "") ||
    !isSymbol(inputValue.object.object, eventSymbol, scopes) ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isCurrentRef(guard.test, refSymbol, scopes) ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== 2
  )
    return false;
  const reset = getAssignment(guard.consequent.body[0]);
  const grow = getAssignment(guard.consequent.body[1]);
  if (
    !reset ||
    !grow ||
    !isRefHeight(reset.left, refSymbol, scopes) ||
    !isLiteralValue(reset.right, "auto") ||
    !isRefHeight(grow.left, refSymbol, scopes) ||
    !isPixelScrollHeight(grow.right, refSymbol, scopes)
  )
    return false;

  const clearCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  for (const reference of setterSymbol.references) {
    const call = reference.identifier.parent;
    if (!call || !isNodeOfType(call, "CallExpression") || call.callee !== reference.identifier)
      return false;
    if (call === update) continue;
    if (call.optional || call.arguments.length !== 1 || !isLiteralValue(call.arguments[0], ""))
      return false;
    clearCalls.push(call);
  }
  for (const reference of refSymbol.references) {
    const identifier = reference.identifier;
    if (identifier === ref) continue;
    const current = identifier.parent;
    if (!current || !isCurrentRef(current, refSymbol, scopes)) return false;
    if (current === guard.test) continue;
    const parent = current.parent;
    if (
      parent &&
      isNodeOfType(parent, "MemberExpression") &&
      isScrollHeight(parent, refSymbol, scopes)
    ) {
      if (parent.range[0] < grow.right.range[0] || parent.range[1] > grow.right.range[1])
        return false;
      continue;
    }
    if (
      parent &&
      isMemberOf(parent, "style") &&
      parent.parent &&
      isRefHeight(parent.parent, refSymbol, scopes)
    ) {
      const assignment = parent.parent.parent;
      if (assignment === reset || assignment === grow) continue;
      if (
        !assignment ||
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.operator !== "=" ||
        assignment.left !== parent.parent ||
        !isLiteralValue(assignment.right, "auto")
      )
        return false;
      const resetFunction = findEnclosingFunction(assignment);
      if (
        !resetFunction ||
        !isFunctionLike(resetFunction) ||
        resetFunction.async ||
        resetFunction.generator ||
        !isNodeOfType(resetFunction.body, "BlockStatement")
      )
        return false;
      const didClear = clearCalls.some(
        (call) =>
          findEnclosingFunction(call) === resetFunction &&
          call.range[0] < assignment.range[0] &&
          call.parent?.parent === resetFunction.body,
      );
      if (!didClear) return false;
      continue;
    }
    if (
      parent &&
      isNodeOfType(parent, "IfStatement") &&
      parent.test === current &&
      !parent.alternate
    )
      continue;
    return false;
  }
  return true;
};
