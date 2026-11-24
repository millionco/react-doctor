import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isDirectNamedReactHookCall } from "../../../utils/is-direct-named-react-hook-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const getVisibleButtonAction = (
  dispatch: SymbolDescriptor,
  state: SymbolDescriptor,
  rendered: EsTreeNodeOfType<"JSXElement">,
  valueSymbols: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): string | null => {
  if (dispatch.references.length !== 1) return null;
  const [reference] = dispatch.references;
  const call = reference.identifier.parent;
  if (
    reference.flag !== "read" ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.callee !== reference.identifier ||
    call.arguments.length !== 1
  ) {
    return null;
  }
  const [argument] = call.arguments;
  const handler = call.parent;
  if (
    !isNodeOfType(argument, "Literal") ||
    typeof argument.value !== "string" ||
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.async ||
    handler.params.length !== 0 ||
    handler.body !== call
  ) {
    return null;
  }
  const expression = handler.parent;
  const attribute = expression?.parent;
  const opening = attribute?.parent;
  const button = opening?.parent;
  if (
    !isNodeOfType(expression, "JSXExpressionContainer") ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "onClick" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.name.name !== "button" ||
    opening.attributes.length !== 1 ||
    !isNodeOfType(button, "JSXElement") ||
    !button.children.some(
      (child) =>
        isNodeOfType(child, "JSXExpressionContainer") &&
        isNodeOfType(child.expression, "Identifier") &&
        scopes.symbolFor(child.expression) === state,
    )
  ) {
    return null;
  }

  return (button === rendered || isAstDescendant(button, rendered)) &&
    isClosedDisplayTree(rendered, button, valueSymbols, scopes) &&
    hasCompleteSymbolReferences(dispatch, scopes.rootScope.node, scopes)
    ? argument.value
    : null;
};

const isClosedDisplayTree = (
  node: EsTreeNode,
  button: EsTreeNodeOfType<"JSXElement">,
  valueSymbols: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(node, "JSXText")) return true;
  if (isNodeOfType(node, "JSXExpressionContainer") && isNodeOfType(node.expression, "Identifier")) {
    const symbol = scopes.symbolFor(node.expression);
    return Boolean(symbol && valueSymbols.has(symbol));
  }
  if (!isNodeOfType(node, "JSXElement")) return false;
  const opening = node.openingElement;
  if (
    node !== button &&
    (!isNodeOfType(opening.name, "JSXIdentifier") ||
      !["div", "section", "main"].includes(opening.name.name) ||
      opening.attributes.length !== 0)
  ) {
    return false;
  }
  return node.children.every((child) => isClosedDisplayTree(child, button, valueSymbols, scopes));
};

const reducerChangesItsInitialValue = (
  hook: EsTreeNodeOfType<"CallExpression">,
  action: string,
  scopes: ScopeAnalysis,
): boolean => {
  const [reducer, initialValue] = hook.arguments;
  if (
    hook.arguments.length !== 2 ||
    !isNodeOfType(reducer, "ArrowFunctionExpression") ||
    reducer.async ||
    reducer.params.length > 2 ||
    reducer.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    !isNodeOfType(initialValue, "Literal") ||
    typeof initialValue.value !== "number" ||
    !Number.isFinite(initialValue.value)
  ) {
    return false;
  }
  const [stateParameter, actionParameter] = reducer.params;
  if (!isNodeOfType(stateParameter, "Identifier")) return false;
  let next = stripParenExpression(reducer.body);
  if (isNodeOfType(next, "ConditionalExpression")) {
    const condition = stripParenExpression(next.test);
    const actionBinding = actionParameter && scopes.symbolFor(actionParameter);
    if (
      !isNodeOfType(condition, "BinaryExpression") ||
      condition.operator !== "===" ||
      !isNodeOfType(condition.left, "Identifier") ||
      !actionBinding ||
      scopes.symbolFor(condition.left) !== actionBinding ||
      !isNodeOfType(condition.right, "Literal") ||
      typeof condition.right.value !== "string"
    ) {
      return false;
    }
    next = stripParenExpression(
      action === condition.right.value ? next.consequent : next.alternate,
    );
  }
  const stateBinding = scopes.symbolFor(stateParameter);
  if (
    !stateBinding ||
    !isNodeOfType(next, "BinaryExpression") ||
    next.operator !== "+" ||
    !isNodeOfType(next.left, "Identifier") ||
    scopes.symbolFor(next.left) !== stateBinding ||
    !isNodeOfType(next.right, "Literal") ||
    typeof next.right.value !== "number"
  ) {
    return false;
  }
  const updatedValue = initialValue.value + next.right.value;
  return Number.isFinite(updatedValue) && updatedValue !== initialValue.value;
};

const isPrimitiveLiteral = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") &&
  (node.value === null || ["boolean", "number", "string"].includes(typeof node.value));

const isLiteralStateReset = (
  statement: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const call = statement.expression;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.arguments.length !== 1
  ) {
    return false;
  }
  const [value] = call.arguments;
  if (!isPrimitiveLiteral(value)) return false;
  const pair = resolveReactUseStatePair(call.callee, scopes);
  return Boolean(
    pair &&
    scopes.symbolFor(call.callee) === pair.setterSymbol &&
    pair.setterSymbol.kind === "const" &&
    findEnclosingFunction(pair.declarator) === component &&
    isDirectNamedReactHookCall(pair.declarator.init, "useState", scopes),
  );
};

interface ReducerBinding {
  hook: EsTreeNodeOfType<"CallExpression">;
  state: SymbolDescriptor;
  dispatch: SymbolDescriptor;
}

const hasClosedComponentEntry = (
  component: EsTreeNodeOfType<"FunctionDeclaration">,
  scopes: ScopeAnalysis,
): boolean => {
  if (component.async || component.generator || component.params.length > 1) return false;
  const [parameter] = component.params;
  if (
    parameter &&
    !isNodeOfType(parameter, "Identifier") &&
    (!isNodeOfType(parameter, "ObjectPattern") ||
      parameter.properties.some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          property.computed ||
          property.kind !== "init" ||
          !isNodeOfType(property.value, "Identifier"),
      ))
  ) {
    return false;
  }

  const parent = component.parent;
  const topLevelComponent =
    isNodeOfType(parent, "ExportNamedDeclaration") ||
    isNodeOfType(parent, "ExportDefaultDeclaration")
      ? parent
      : component;
  const program = scopes.rootScope.node;
  return (
    isNodeOfType(program, "Program") &&
    program.body.some((statement) => statement === topLevelComponent) &&
    program.body.every(
      (statement) =>
        statement === topLevelComponent ||
        (isNodeOfType(statement, "ImportDeclaration") && statement.source.value === "react"),
    )
  );
};

export const hasIndependentVisibleReducer = (
  component: EsTreeNode,
  effectCall: EsTreeNode,
  effect: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(effectCall, "CallExpression")) return false;
  const [setup, dependencies] = effectCall.arguments;
  if (
    effectCall.arguments.length !== 2 ||
    setup !== effect ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.some((dependency) => !isNodeOfType(dependency, "Identifier")) ||
    !isNodeOfType(component, "FunctionDeclaration") ||
    !hasClosedComponentEntry(component, scopes) ||
    !isNodeOfType(component.body, "BlockStatement") ||
    !isNodeOfType(effectCall.parent, "ExpressionStatement") ||
    effectCall.parent.parent !== component.body ||
    !isDirectNamedReactHookCall(effectCall, "useEffect", scopes) ||
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    effect.async ||
    effect.params.length !== 0 ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    !effect.body.body.every((statement) => isLiteralStateReset(statement, component, scopes))
  ) {
    return false;
  }

  const rendered = component.body.body.at(-1);
  if (
    !isNodeOfType(rendered, "ReturnStatement") ||
    !isNodeOfType(rendered.argument, "JSXElement")
  ) {
    return false;
  }

  let reducer: ReducerBinding | null = null;
  const valueSymbols = new Set<SymbolDescriptor>();
  for (const statement of component.body.body.slice(0, -1)) {
    if (statement === effectCall.parent) continue;
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return false;
    for (const declaration of statement.declarations) {
      if (!isNodeOfType(declaration.id, "ArrayPattern") || declaration.id.elements.length !== 2) {
        return false;
      }
      const [stateIdentifier, dispatchIdentifier] = declaration.id.elements;
      const hook = declaration.init;
      if (
        !isNodeOfType(stateIdentifier, "Identifier") ||
        !isNodeOfType(dispatchIdentifier, "Identifier") ||
        !isNodeOfType(hook, "CallExpression")
      ) {
        return false;
      }
      const state = scopes.symbolFor(stateIdentifier);
      const dispatch = scopes.symbolFor(dispatchIdentifier);
      if (!state || !dispatch || state.references.some((reference) => reference.flag !== "read")) {
        return false;
      }
      valueSymbols.add(state);
      if (isDirectNamedReactHookCall(hook, "useState", scopes)) {
        if (hook.arguments.length !== 1 || !isPrimitiveLiteral(hook.arguments[0])) return false;
      } else {
        if (reducer || !isDirectNamedReactHookCall(hook, "useReducer", scopes)) return false;
        reducer = { hook, state, dispatch };
      }
    }
  }
  if (!reducer) return false;
  const action = getVisibleButtonAction(
    reducer.dispatch,
    reducer.state,
    rendered.argument,
    valueSymbols,
    scopes,
  );
  return action !== null && reducerChangesItsInitialValue(reducer.hook, action, scopes);
};
