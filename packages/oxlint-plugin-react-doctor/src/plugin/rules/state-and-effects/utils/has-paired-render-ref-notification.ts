import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { UseStateBinding } from "./collect-use-state-bindings.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { isRefNotificationNativeEvent } from "./is-ref-notification-native-event.js";
import { hasRefNotificationReactCall } from "./has-ref-notification-react-call.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { readConstantBoolean } from "../../../utils/read-constant-boolean.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getComponentRenderDependencyAnalysis } from "./get-component-render-dependency-analysis.js";
import { hasRenderedRefPrimitive } from "./has-rendered-ref-primitive.js";

interface RefPublicationPair {
  assignment: EsTreeNodeOfType<"AssignmentExpression">;
  call: EsTreeNodeOfType<"CallExpression">;
  value: EsTreeNodeOfType<"Literal">;
  owner: EsTreeNode;
}

const primitiveLiteral = (
  node: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"Literal"> | null => {
  const expression = node && stripParenExpression(node);
  return isNodeOfType(expression, "Literal") &&
    (expression.value === null ||
      typeof expression.value === "string" ||
      typeof expression.value === "boolean" ||
      (typeof expression.value === "number" && Number.isFinite(expression.value)))
    ? expression
    : null;
};

const refMember = (node: EsTreeNode, symbol: SymbolDescriptor, context: RuleContext): boolean => {
  const member = stripParenExpression(node);
  return (
    isNodeOfType(member, "MemberExpression") &&
    !member.computed &&
    !member.optional &&
    isNodeOfType(member.property, "Identifier") &&
    member.property.name === "current" &&
    isNodeOfType(stripParenExpression(member.object), "Identifier") &&
    context.scopes.symbolFor(stripParenExpression(member.object)) === symbol
  );
};

export const hasPairedRenderRefNotification = (
  binding: UseStateBinding,
  componentBody: EsTreeNode,
  context: RuleContext,
): boolean => {
  const declarator = binding.declarator;
  if (
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== 2 ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !hasRefNotificationReactCall(declarator.init, "useState", context) ||
    declarator.init.arguments.length !== 1
  )
    return false;
  const [stateIdentifier, setterIdentifier] = declarator.id.elements;
  if (!isNodeOfType(stateIdentifier, "Identifier") || !isNodeOfType(setterIdentifier, "Identifier"))
    return false;
  const state = context.scopes.symbolFor(stateIdentifier);
  const setter = context.scopes.symbolFor(setterIdentifier);
  const initial = primitiveLiteral(declarator.init.arguments?.[0]);
  const program = findProgramRoot(componentBody);
  const componentFunction = findEnclosingFunction(componentBody);
  if (
    !state ||
    !setter ||
    !initial ||
    !program ||
    !componentFunction ||
    !hasCompleteSymbolReferences(state, program, context.scopes) ||
    !hasCompleteSymbolReferences(setter, program, context.scopes)
  )
    return false;
  const pairs: RefPublicationPair[] = [];
  const mirrorCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  let selectedRef: SymbolDescriptor | null = null;
  for (const reference of setter.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== root ||
      call.optional ||
      call.arguments.length !== 1 ||
      !isNodeOfType(call.parent, "ExpressionStatement")
    )
      return false;
    const value = primitiveLiteral(call.arguments[0]);
    if (!value) {
      mirrorCalls.push(call);
      continue;
    }
    const block = call.parent.parent;
    if (!isNodeOfType(block, "BlockStatement")) return false;
    const previous = block.body[block.body.findIndex((statement) => statement === call.parent) - 1];
    const assignment =
      isNodeOfType(previous, "ExpressionStatement") && stripParenExpression(previous.expression);
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      !isNodeOfType(assignment.left, "MemberExpression") ||
      assignment.left.computed ||
      assignment.left.optional ||
      !Object.is(primitiveLiteral(assignment.right)?.value, value.value)
    )
      return false;
    const symbol = resolveReactRefSymbol(assignment.left, context.scopes);
    const initializer = symbol && getDirectConstInitializer(symbol);
    const owner = findEnclosingFunction(call);
    if (
      !symbol ||
      (selectedRef && symbol !== selectedRef) ||
      !isFunctionLike(owner) ||
      owner === componentFunction ||
      !isNodeOfType(initializer, "CallExpression") ||
      !hasRefNotificationReactCall(initializer, "useRef", context) ||
      initializer.arguments.length !== 1 ||
      findEnclosingFunction(symbol.declarationNode) !== componentFunction ||
      !Object.is(primitiveLiteral(initializer.arguments[0])?.value, initial.value)
    )
      return false;
    selectedRef = symbol;
    pairs.push({ assignment, call, value, owner });
  }
  if (!selectedRef || !hasCompleteSymbolReferences(selectedRef, program, context.scopes))
    return false;
  for (const owner of new Set(pairs.map((pair) => pair.owner))) {
    const ownerRoot = findTransparentExpressionRoot(owner);
    if (isNodeOfType(ownerRoot.parent, "CallExpression") && ownerRoot.parent.callee === ownerRoot)
      return false;
    const identifier = getFunctionBindingIdentifier(owner);
    if (!identifier) {
      const call = ownerRoot.parent;
      const enclosingOwner = call && findEnclosingFunction(call);
      const enclosingIdentifier = enclosingOwner && getFunctionBindingIdentifier(enclosingOwner);
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        !call.arguments.some((argument) => argument === ownerRoot) ||
        !isNodeOfType(call.callee, "MemberExpression") ||
        call.callee.computed ||
        call.callee.optional ||
        !isNodeOfType(call.callee.property, "Identifier") ||
        call.callee.property.name !== "then" ||
        !enclosingIdentifier ||
        !pairs.some((pair) => pair.owner === enclosingOwner)
      )
        return false;
      continue;
    }
    if (
      isNodeOfType(ownerRoot.parent, "CallExpression") &&
      (!hasRefNotificationReactCall(ownerRoot.parent, "useCallback", context) ||
        ownerRoot.parent.arguments.length !== 2 ||
        ownerRoot.parent.arguments[0] !== ownerRoot)
    )
      return false;
    const symbol = context.scopes.symbolFor(identifier);
    if (
      !symbol ||
      symbol.references.length === 0 ||
      !hasCompleteSymbolReferences(symbol, program, context.scopes)
    )
      return false;
    if (
      symbol.references.some((reference) => {
        const root = findTransparentExpressionRoot(reference.identifier);
        const container = root.parent;
        const attribute = container?.parent;
        return (
          reference.flag !== "read" ||
          !isNodeOfType(container, "JSXExpressionContainer") ||
          container.expression !== root ||
          !isNodeOfType(attribute, "JSXAttribute") ||
          !isNodeOfType(attribute.name, "JSXIdentifier") ||
          !/^on[A-Z]/.test(attribute.name.name) ||
          !isRefNotificationNativeEvent(attribute, componentFunction, context)
        );
      })
    )
      return false;
  }
  const ref = selectedRef;
  const allowedStateReads = new Set<EsTreeNode>();
  for (const call of mirrorCalls) {
    if (!refMember(call.arguments[0], ref, context)) return false;
    const owner = findEnclosingFunction(call);
    if (
      !isFunctionLike(owner) ||
      !isNodeOfType(owner.body, "BlockStatement") ||
      owner.body.body.length !== 1
    )
      return false;
    const guard = owner.body.body[0];
    const hook = findTransparentExpressionRoot(owner).parent;
    if (
      !isNodeOfType(guard, "IfStatement") ||
      guard.alternate ||
      !isNodeOfType(guard.test, "BinaryExpression") ||
      guard.test.operator !== "!==" ||
      !refMember(guard.test.left, ref, context) ||
      context.scopes.symbolFor(guard.test.right) !== state ||
      !isNodeOfType(hook, "CallExpression") ||
      hook.arguments.length !== 2 ||
      hook.arguments[0] !== owner ||
      !hasRefNotificationReactCall(hook, "useLayoutEffect", context)
    )
      return false;
    const consequent = isNodeOfType(guard.consequent, "BlockStatement")
      ? guard.consequent.body
      : [guard.consequent];
    if (consequent.length !== 1 || consequent[0] !== call.parent) return false;
    allowedStateReads.add(guard.test.right);
    const dependencies = hook.arguments[1];
    if (!isNodeOfType(dependencies, "ArrayExpression")) return false;
    for (const element of dependencies.elements) {
      if (element && context.scopes.symbolFor(element) === state) allowedStateReads.add(element);
    }
    if (
      !dependencies.elements.some(
        (element) => element && context.scopes.symbolFor(element) === state,
      )
    )
      return false;
  }
  if (
    state.references.some(
      (reference) => reference.flag !== "read" || !allowedStateReads.has(reference.identifier),
    )
  )
    return false;
  const independentResetGuard = (node: EsTreeNode): boolean => {
    let cursor = node.parent;
    let hasIndependentCondition = false;
    while (cursor && cursor !== componentFunction) {
      if (
        isNodeOfType(cursor, "IfStatement") &&
        readConstantBoolean(cursor.test, context.scopes) === null
      ) {
        let hasSelectedRead = false;
        const seen = new Set<number>();
        const inspect = (expression: EsTreeNode): void => {
          walkAst(expression, (child) => {
            if (!isNodeOfType(child, "Identifier")) return;
            const symbol = context.scopes.symbolFor(child);
            if (symbol === ref || symbol === state || symbol === setter) hasSelectedRead = true;
            if (symbol && !seen.has(symbol.id)) {
              seen.add(symbol.id);
              const initializer = getDirectConstInitializer(symbol);
              if (initializer) inspect(initializer);
            }
          });
        };
        inspect(cursor.test);
        if (hasSelectedRead) return false;
        hasIndependentCondition = true;
      }
      cursor = cursor.parent;
    }
    return hasIndependentCondition;
  };
  const assignments = new Set(pairs.map((pair) => pair.assignment));
  const reads: EsTreeNodeOfType<"MemberExpression">[] = [];
  for (const reference of ref.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      !refMember(member, ref, context)
    )
      return false;
    if (!isWithinAssignmentTarget(member)) {
      reads.push(member);
      continue;
    }
    const assignment = findTransparentExpressionRoot(member).parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.left !== member ||
      assignment.operator !== "="
    )
      return false;
    if (
      !assignments.has(assignment) &&
      !(
        findEnclosingFunction(assignment) === componentFunction &&
        Object.is(primitiveLiteral(assignment.right)?.value, initial.value) &&
        independentResetGuard(assignment)
      )
    )
      return false;
  }
  const { renderReachableNames } = getComponentRenderDependencyAnalysis(
    componentBody,
    context.scopes,
  );
  if (!renderReachableNames.has(ref.name)) return false;
  return pairs.some((pair) => {
    const owner = pair.owner;
    if (
      Object.is(pair.value.value, initial.value) ||
      typeof pair.value.value !== typeof initial.value ||
      !isFunctionLike(owner) ||
      !getFunctionBindingIdentifier(owner) ||
      !isNodeReachableWithinFunction(pair.call, context)
    )
      return false;
    let ancestor = pair.call.parent;
    while (ancestor && ancestor !== owner) {
      if (
        isNodeOfType(ancestor, "WhileStatement") ||
        isNodeOfType(ancestor, "DoWhileStatement") ||
        isNodeOfType(ancestor, "ForStatement") ||
        isNodeOfType(ancestor, "ForInStatement") ||
        isNodeOfType(ancestor, "ForOfStatement") ||
        isNodeOfType(ancestor, "SwitchStatement")
      )
        return false;
      if (isNodeOfType(ancestor, "IfStatement")) {
        const condition = readConstantBoolean(ancestor.test, context.scopes);
        const branch = ancestor.consequent;
        const isConsequent =
          pair.call.range[0] >= branch.range[0] && pair.call.range[1] <= branch.range[1];
        if ((isConsequent && condition === false) || (!isConsequent && condition === true))
          return false;
      }
      ancestor = ancestor.parent;
    }
    let hasLaterWork = false;
    walkAst(owner.body, (node) => {
      if (
        node !== owner.body &&
        (isNodeOfType(node, "ArrowFunctionExpression") ||
          isNodeOfType(node, "FunctionExpression") ||
          isNodeOfType(node, "FunctionDeclaration"))
      )
        return false;
      if (node.range[0] >= pair.call.range[1]) hasLaterWork = true;
    });
    return (
      !hasLaterWork &&
      reads.some((read) =>
        hasRenderedRefPrimitive({
          read,
          value: pair.value,
          componentBody,
          program,
          context,
        }),
      )
    );
  });
};
