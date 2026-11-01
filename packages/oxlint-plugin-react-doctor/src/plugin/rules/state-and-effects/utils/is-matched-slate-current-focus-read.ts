import { getRuntimeSymbolReferences } from "../../../utils/get-runtime-symbol-references.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { isSlateCurrentFocusProvider } from "./is-slate-current-focus-provider.js";

interface SlateCurrentFocusRead {
  readonly receiver: EsTreeNodeOfType<"Identifier">;
  readonly key: EsTreeNodeOfType<"Identifier">;
}

const getSlateCurrentFocusRead = (
  node: EsTreeNode | null | undefined,
): SlateCurrentFocusRead | null => {
  if (!node) return null;
  const expression = stripParenExpression(node);
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== 1
  )
    return null;
  const member = expression.callee;
  const key = expression.arguments[0];
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.object, "Identifier") ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "isFocused" ||
    !isNodeOfType(key, "Identifier")
  )
    return null;
  return { receiver: member.object, key };
};

const isReadonlyNamedReactFocusHook = (
  node: EsTreeNode,
  importedName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(node.callee);
  return Boolean(
    symbol &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === importedName &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
    getRuntimeSymbolReferences(symbol).every((reference) => {
      const call = reference.identifier.parent;
      return (
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        isNodeOfType(call, "CallExpression") &&
        !call.optional &&
        call.callee === reference.identifier
      );
    }),
  );
};

const hasReadonlyFocusKeyBinding = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  getRuntimeSymbolReferences(symbol).every((reference) => {
    if (reference.flag !== "read") return false;
    if (!isWithinAssignmentTarget(reference.identifier)) return true;
    const parent = reference.identifier.parent;
    return isNodeOfType(parent, "MemberExpression") && parent.object === reference.identifier;
  });

const hasSelectedFocusKeyDeclaration = (
  symbol: SymbolDescriptor,
  component: EsTreeNode,
): boolean => {
  const identifier = symbol.bindingIdentifier;
  const declaration = symbol.declarationNode;
  if (symbol.kind === "parameter") {
    const parent = identifier.parent;
    if (parent === component) return true;
    if (!isNodeOfType(parent, "Property") || parent.value !== identifier || parent.computed)
      return false;
    const pattern = parent.parent;
    return isNodeOfType(pattern, "ObjectPattern") && pattern.parent === component;
  }
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    findEnclosingFunction(declaration) !== component
  )
    return false;
  if (declaration.id === identifier) return true;
  const property = identifier.parent;
  return Boolean(
    isNodeOfType(property, "Property") &&
    property.value === identifier &&
    !property.computed &&
    isNodeOfType(property.parent, "ObjectPattern") &&
    declaration.id === property.parent,
  );
};

export const isMatchedSlateCurrentFocusRead = (
  context: RuleContext,
  stateDeclarator: EsTreeNode,
  setterCall: EsTreeNode,
): boolean => {
  try {
    if (
      !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
      !isNodeOfType(stateDeclarator.id, "ArrayPattern") ||
      stateDeclarator.id.elements.length !== 2 ||
      !isNodeOfType(stateDeclarator.init, "CallExpression") ||
      stateDeclarator.init.arguments.length !== 1 ||
      !isReadonlyNamedReactFocusHook(stateDeclarator.init, "useState", context.scopes) ||
      !isNodeOfType(stateDeclarator.parent, "VariableDeclaration") ||
      stateDeclarator.parent.kind !== "const" ||
      !isNodeOfType(setterCall, "CallExpression") ||
      setterCall.optional ||
      setterCall.arguments.length !== 1 ||
      !isNodeOfType(setterCall.callee, "Identifier")
    )
      return false;
    const stateIdentifier = stateDeclarator.id.elements[0];
    const setterIdentifier = stateDeclarator.id.elements[1];
    if (
      !isNodeOfType(stateIdentifier, "Identifier") ||
      !isNodeOfType(setterIdentifier, "Identifier")
    )
      return false;
    const setterSymbol = context.scopes.symbolFor(setterIdentifier);
    if (
      !setterSymbol ||
      context.scopes.symbolFor(setterCall.callee) !== setterSymbol ||
      !hasCompleteSymbolReferences(setterSymbol, context.scopes.rootScope.node, context.scopes) ||
      !getRuntimeSymbolReferences(setterSymbol).every((reference) => {
        const call = reference.identifier.parent;
        return (
          reference.flag === "read" &&
          !isWithinAssignmentTarget(reference.identifier) &&
          isNodeOfType(call, "CallExpression") &&
          !call.optional &&
          call.callee === reference.identifier
        );
      })
    )
      return false;
    const initialRead = getSlateCurrentFocusRead(stateDeclarator.init.arguments[0]);
    const nextRead = getSlateCurrentFocusRead(setterCall.arguments[0]);
    if (!initialRead || !nextRead) return false;
    const providerSymbol = context.scopes.symbolFor(initialRead.receiver);
    const keySymbol = context.scopes.symbolFor(initialRead.key);
    if (
      !providerSymbol ||
      context.scopes.symbolFor(nextRead.receiver) !== providerSymbol ||
      !keySymbol ||
      context.scopes.symbolFor(nextRead.key) !== keySymbol ||
      !hasReadonlyFocusKeyBinding(keySymbol, context.scopes)
    )
      return false;
    const expressionStatement = setterCall.parent;
    const effectBody = expressionStatement?.parent;
    const callback = effectBody?.parent;
    const effectCall = callback?.parent;
    if (
      !isNodeOfType(expressionStatement, "ExpressionStatement") ||
      expressionStatement.expression !== setterCall ||
      !isNodeOfType(effectBody, "BlockStatement") ||
      effectBody.body.length !== 1 ||
      effectBody.body[0] !== expressionStatement ||
      (!isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")) ||
      callback.body !== effectBody ||
      callback.async ||
      callback.generator ||
      callback.params.length !== 0 ||
      !isNodeOfType(effectCall, "CallExpression") ||
      effectCall.arguments.length !== 2 ||
      effectCall.arguments[0] !== callback ||
      !isReadonlyNamedReactFocusHook(effectCall, "useEffect", context.scopes)
    )
      return false;
    const dependencies = effectCall.arguments[1];
    if (!isNodeOfType(dependencies, "ArrayExpression") || dependencies.elements.length !== 1)
      return false;
    const dependency = dependencies.elements[0];
    if (
      !isNodeOfType(dependency, "Identifier") ||
      context.scopes.symbolFor(dependency) !== keySymbol
    )
      return false;
    const component = findEnclosingFunction(stateDeclarator);
    if (
      (!isNodeOfType(component, "ArrowFunctionExpression") &&
        !isNodeOfType(component, "FunctionExpression") &&
        !isNodeOfType(component, "FunctionDeclaration")) ||
      !isNodeOfType(component.body, "BlockStatement") ||
      findEnclosingFunction(effectCall) !== component ||
      !hasSelectedFocusKeyDeclaration(keySymbol, component) ||
      stateDeclarator.parent.parent !== component.body ||
      !isNodeOfType(effectCall.parent, "ExpressionStatement") ||
      effectCall.parent.parent !== component.body
    )
      return false;
    const statePosition = component.body.body.findIndex(
      (statement) => statement === stateDeclarator.parent,
    );
    const effectPosition = component.body.body.findIndex(
      (statement) => statement === effectCall.parent,
    );
    return (
      statePosition >= 0 &&
      statePosition < effectPosition &&
      isSlateCurrentFocusProvider(context, initialRead.receiver)
    );
  } catch {
    return false;
  }
};
