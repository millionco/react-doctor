import { getRuntimeSymbolReferences } from "./get-runtime-symbol-references.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getClosedComponentJsxCalls } from "./get-closed-component-jsx-calls.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import type {
  RequestActionProgram,
  RequestActionProof,
  RequestActionValue,
} from "./get-imported-request-action-evidence.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface JotaiVisibilityAction {
  readonly atom: SymbolDescriptor;
  readonly facts: RequestActionProgram;
  readonly visibilityKey: string;
}

export const isImportedJotaiVisibilityAction = (
  node: EsTreeNode,
  handler: EsTreeNode,
  proof: RequestActionProof,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== 0 ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const action = proof.caller.scopes.symbolFor(node.callee);
  const component = findEnclosingFunction(handler);
  if (
    !action ||
    !proof.closed(action, proof.caller) ||
    !component ||
    !isFunctionLike(component) ||
    component.params.length !== 1 ||
    component.async ||
    component.generator
  )
    return false;
  const actionProperty = getDestructuredBindingPropertyName(action.bindingIdentifier);
  const pattern = action.bindingIdentifier.parent?.parent;
  if (
    !actionProperty ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    pattern.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") ||
        property.computed ||
        !isNodeOfType(property.value, "Identifier"),
    )
  )
    return false;
  if (pattern !== component.params[0]) {
    const declaration = pattern.parent;
    if (
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.init, "Identifier") ||
      !isNodeOfType(component.params[0], "Identifier") ||
      proof.caller.scopes.symbolFor(declaration.init) !==
        proof.caller.scopes.symbolFor(component.params[0]) ||
      !proof.closed(proof.caller.scopes.symbolFor(component.params[0]), proof.caller)
    )
      return false;
    const props = proof.caller.scopes.symbolFor(component.params[0]);
    if (
      !props ||
      !getRuntimeSymbolReferences(props).every(
        (reference) =>
          isKeyedDraftTypeReference(reference.identifier) ||
          reference.identifier === declaration.init,
      )
    )
      return false;
  }
  let handlerRoot: EsTreeNode = handler;
  while (
    handlerRoot.parent &&
    "expression" in handlerRoot.parent &&
    stripParenExpression(handlerRoot.parent) === handler
  )
    handlerRoot = handlerRoot.parent;
  const handlerParent = handlerRoot.parent;
  if (isNodeOfType(handlerParent, "CallExpression")) {
    const dependencies = handlerParent.arguments[1];
    if (
      stripParenExpression(handlerParent.arguments[0] ?? handlerParent) !== handler ||
      handlerParent.optional ||
      !proof.api(handlerParent.callee, "react", "useCallback", proof.caller) ||
      handlerParent.arguments.length !== 2 ||
      !isNodeOfType(dependencies, "ArrayExpression") ||
      !dependencies.elements.some(
        (element) =>
          isNodeOfType(element, "Identifier") && proof.caller.scopes.symbolFor(element) === action,
      )
    )
      return false;
  }
  const calls = getClosedComponentJsxCalls(component, proof.context);
  if (!calls?.length) return false;
  const returnedExpression = (functionNode: EsTreeNode): EsTreeNode | null => {
    if (
      !isFunctionLike(functionNode) ||
      functionNode.async ||
      functionNode.generator ||
      functionNode.params.length !== 0 ||
      !functionNode.body
    )
      return null;
    if (!isNodeOfType(functionNode.body, "BlockStatement"))
      return stripParenExpression(functionNode.body);
    const returns = collectFunctionReturnStatements(functionNode);
    return returns.length === 1 && returns[0]?.argument
      ? stripParenExpression(returns[0].argument)
      : null;
  };
  const importedHookResult = (
    call: EsTreeNode,
    facts: RequestActionProgram,
  ): RequestActionValue | null => {
    if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 0)
      return null;
    const resolved = proof.resolve(call.callee, facts);
    return resolved &&
      isFunctionLike(resolved.node) &&
      !resolved.node.async &&
      !resolved.node.generator &&
      resolved.node.params.length === 0 &&
      proof.closedFunction(resolved.node, resolved.facts)
      ? resolved
      : null;
  };
  const atomForHook = (
    call: EsTreeNode,
    hookName: string,
    facts: RequestActionProgram,
  ): SymbolDescriptor | null => {
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== 1 ||
      !proof.api(call.callee, "jotai", hookName, facts) ||
      !isNodeOfType(call.arguments[0], "Identifier")
    )
      return null;
    const atom = facts.scopes.symbolFor(call.arguments[0]);
    if (
      !atom ||
      atom.kind !== "const" ||
      atom.scope !== facts.scopes.rootScope ||
      !proof.closed(atom, facts) ||
      !isNodeOfType(atom.initializer, "CallExpression") ||
      atom.initializer.arguments.length !== 1 ||
      atom.initializer.optional ||
      !proof.api(atom.initializer.callee, "jotai", "atom", facts) ||
      !isNodeOfType(atom.initializer.arguments[0], "ObjectExpression")
    )
      return null;
    if (
      !isNodeOfType(atom.declarationNode, "VariableDeclarator") ||
      !isNodeOfType(atom.declarationNode.parent, "VariableDeclaration") ||
      atom.declarationNode.parent.parent !== facts.program
    )
      return null;
    return getRuntimeSymbolReferences(atom).every((reference) => {
      const parent = reference.identifier.parent;
      return (
        isNodeOfType(parent, "CallExpression") &&
        parent.arguments.length === 1 &&
        parent.arguments[0] === reference.identifier &&
        (proof.api(parent.callee, "jotai", "useAtomValue", facts) ||
          proof.api(parent.callee, "jotai", "useSetAtom", facts))
      );
    })
      ? atom
      : null;
  };
  const resolveParentAction = (
    expression: EsTreeNode,
    parentComponent: EsTreeNode,
  ): JotaiVisibilityAction | null => {
    if (!isNodeOfType(expression, "Identifier")) return null;
    const parentAction = proof.caller.scopes.symbolFor(expression);
    if (
      !parentAction ||
      !proof.closed(parentAction, proof.caller) ||
      !parentAction.initializer ||
      findEnclosingFunction(parentAction.declarationNode) !== parentComponent
    )
      return null;
    const propertyName = getDestructuredBindingPropertyName(parentAction.bindingIdentifier);
    const property = parentAction.bindingIdentifier.parent;
    if (
      !propertyName ||
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.value !== parentAction.bindingIdentifier
    )
      return null;
    const hook = importedHookResult(parentAction.initializer, proof.caller);
    if (!hook) return null;
    const result = returnedExpression(hook.node);
    const selected = result ? proof.property(result, propertyName) : null;
    const callbackValue = selected ? proof.resolve(selected, hook.facts) : null;
    if (
      !callbackValue ||
      !isNodeOfType(callbackValue.node, "CallExpression") ||
      callbackValue.node.optional ||
      callbackValue.node.arguments.length !== 2 ||
      !proof.api(callbackValue.node.callee, "react", "useCallback", hook.facts)
    )
      return null;
    if (findEnclosingFunction(callbackValue.node) !== hook.node) return null;
    const callback = callbackValue.node.arguments[0];
    const dependencies = callbackValue.node.arguments[1];
    if (
      !isFunctionLike(callback) ||
      callback.async ||
      callback.generator ||
      callback.params.length !== 0 ||
      !callback.body ||
      !isNodeOfType(dependencies, "ArrayExpression") ||
      dependencies.elements.length !== 1
    )
      return null;
    let setterCall: EsTreeNode = stripParenExpression(callback.body);
    if (isNodeOfType(callback.body, "BlockStatement")) {
      const statement = callback.body.body[0];
      if (callback.body.body.length !== 1 || !isNodeOfType(statement, "ExpressionStatement"))
        return null;
      setterCall = stripParenExpression(statement.expression);
    }
    if (
      !isNodeOfType(setterCall, "CallExpression") ||
      setterCall.optional ||
      setterCall.arguments.length !== 1 ||
      !isNodeOfType(setterCall.callee, "Identifier")
    )
      return null;
    const setter = hook.facts.scopes.symbolFor(setterCall.callee);
    if (
      !setter ||
      !proof.closed(setter, hook.facts) ||
      !setter.initializer ||
      !isNodeOfType(dependencies.elements[0], "Identifier") ||
      hook.facts.scopes.symbolFor(dependencies.elements[0]) !== setter
    )
      return null;
    if (
      findEnclosingFunction(setter.declarationNode) !== hook.node ||
      !getRuntimeSymbolReferences(setter).every((reference) => {
        const parent = reference.identifier.parent;
        if (
          isNodeOfType(parent, "CallExpression") &&
          parent.callee === reference.identifier &&
          !parent.optional &&
          parent.arguments.length === 1
        )
          return true;
        const owner = parent?.parent;
        return (
          isNodeOfType(parent, "ArrayExpression") &&
          parent.elements.length === 1 &&
          parent.elements[0] === reference.identifier &&
          isNodeOfType(owner, "CallExpression") &&
          owner.arguments[1] === parent &&
          proof.api(owner.callee, "react", "useCallback", hook.facts)
        );
      })
    )
      return null;
    const atom = atomForHook(setter.initializer, "useSetAtom", hook.facts);
    if (!atom || !isNodeOfType(atom.initializer, "CallExpression")) return null;
    const nextValue = setterCall.arguments[0];
    if (!isNodeOfType(nextValue, "ObjectExpression")) return null;
    const writtenKeys = new Set<string>();
    for (const member of nextValue.properties) {
      if (
        !isNodeOfType(member, "Property") ||
        member.computed ||
        member.method ||
        member.kind !== "init" ||
        !isNodeOfType(member.key, "Identifier")
      )
        return null;
      if (writtenKeys.has(member.key.name)) return null;
      writtenKeys.add(member.key.name);
      if (
        !isNodeOfType(member.value, "Literal") &&
        !(isNodeOfType(member.value, "ArrayExpression") && member.value.elements.length === 0)
      )
        return null;
    }
    const visibility = nextValue.properties.filter(
      (member) =>
        isNodeOfType(member, "Property") &&
        isNodeOfType(member.value, "Literal") &&
        member.value.value === false,
    );
    if (
      visibility.length !== 1 ||
      !isNodeOfType(visibility[0], "Property") ||
      !isNodeOfType(visibility[0].key, "Identifier")
    )
      return null;
    const visibilityKey = visibility[0].key.name;
    const initial = atom.initializer.arguments[0];
    const initialVisibility = initial ? proof.property(initial, visibilityKey) : null;
    if (!isNodeOfType(initialVisibility, "Literal") || typeof initialVisibility.value !== "boolean")
      return null;
    return { atom, facts: hook.facts, visibilityKey };
  };
  const matchesVisibility = (
    expression: EsTreeNode,
    selected: JotaiVisibilityAction,
    parentComponent: EsTreeNode,
  ): boolean => {
    const member = stripParenExpression(expression);
    if (
      !isNodeOfType(member, "MemberExpression") ||
      getStaticPropertyName(member) !== selected.visibilityKey ||
      !isNodeOfType(member.object, "Identifier")
    )
      return false;
    const status = proof.caller.scopes.symbolFor(member.object);
    if (
      !status ||
      !proof.closed(status, proof.caller) ||
      !status.initializer ||
      findEnclosingFunction(status.declarationNode) !== parentComponent
    )
      return false;
    const hook = importedHookResult(status.initializer, proof.caller);
    if (!hook || hook.facts.program !== selected.facts.program) return false;
    const value = returnedExpression(hook.node);
    return Boolean(value && atomForHook(value, "useAtomValue", hook.facts) === selected.atom);
  };
  const hasVisibilityGate = (opening: EsTreeNode, selected: JotaiVisibilityAction): boolean => {
    const parentComponent = findEnclosingFunction(opening);
    if (!parentComponent) return false;
    let ancestor: EsTreeNode | null | undefined = opening;
    while (ancestor && !isFunctionLike(ancestor)) {
      const parent: EsTreeNode | null | undefined = ancestor.parent;
      if (
        isNodeOfType(parent, "ConditionalExpression") &&
        parent.consequent === ancestor &&
        matchesVisibility(parent.test, selected, parentComponent)
      )
        return true;
      if (
        isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "&&" &&
        parent.right === ancestor &&
        matchesVisibility(parent.left, selected, parentComponent)
      )
        return true;
      ancestor = parent;
    }
    if (!ancestor || !isFunctionLike(ancestor) || !isNodeOfType(ancestor.body, "BlockStatement"))
      return false;
    let containing: EsTreeNode = opening;
    while (containing.parent && containing.parent !== ancestor.body) containing = containing.parent;
    const position = ancestor.body.body.findIndex((statement) => statement === containing);
    if (position < 0) return false;
    return ancestor.body.body.slice(0, position).some((statement) => {
      if (
        !isNodeOfType(statement, "IfStatement") ||
        statement.alternate ||
        !isNodeOfType(statement.test, "UnaryExpression") ||
        statement.test.operator !== "!" ||
        !matchesVisibility(statement.test.argument, selected, parentComponent)
      )
        return false;
      const exit =
        isNodeOfType(statement.consequent, "BlockStatement") &&
        statement.consequent.body.length === 1
          ? statement.consequent.body[0]
          : statement.consequent;
      return (
        isNodeOfType(exit, "ReturnStatement") &&
        (!exit.argument ||
          (isNodeOfType(exit.argument, "Literal") && exit.argument.value === null) ||
          (isNodeOfType(exit.argument, "JSXFragment") && exit.argument.children.length === 0))
      );
    });
  };
  return calls.every((opening) => {
    let expression: EsTreeNode | null = null;
    for (const attribute of opening.attributes) {
      if (!isNodeOfType(attribute, "JSXAttribute")) return false;
      if (!isNodeOfType(attribute.name, "JSXIdentifier") || attribute.name.name !== actionProperty)
        continue;
      if (expression || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
      expression = attribute.value.expression;
    }
    const parentComponent = findEnclosingFunction(opening);
    const selected =
      expression && parentComponent ? resolveParentAction(expression, parentComponent) : null;
    return Boolean(selected && hasVisibilityGate(opening, selected));
  });
};
