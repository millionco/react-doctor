import {
  RADIX_DRAFT_EMPTY_COUNT,
  RADIX_DRAFT_SINGLE_COUNT,
  RADIX_DRAFT_PAIR_COUNT,
  RADIX_DRAFT_THREE_STATEMENTS_COUNT,
  RADIX_DRAFT_FIRST_INDEX,
  RADIX_DRAFT_SECOND_INDEX,
} from "./constants.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import type { EffectStateWriteFact } from "./collect-effect-state-write-facts.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasUserInputSetterWriter } from "./has-user-input-setter-writer.js";
import { hasSupportedRadixDraftEventCall } from "./has-supported-radix-draft-event-call.js";
import { hasSupportedRadixReactCall } from "./has-supported-radix-react-call.js";

const sameBinding = (context: RuleContext, left: EsTreeNode, right: EsTreeNode): boolean => {
  const symbol = context.scopes.symbolFor(left);
  return Boolean(symbol && symbol === context.scopes.symbolFor(right));
};

const branchWritesDraft = (
  branch: EsTreeNode,
  state: EsTreeNode,
  setter: EsTreeNode,
  selectedValue: EsTreeNode,
  component: EsTreeNode,
  isAppend: boolean,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(branch, "BlockStatement") ||
    branch.body.length < RADIX_DRAFT_PAIR_COUNT ||
    branch.body.length > RADIX_DRAFT_THREE_STATEMENTS_COUNT
  )
    return false;
  const [declaration, write, notification] = branch.body;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(write, "ExpressionStatement")
  )
    return false;
  const next = declaration.declarations[RADIX_DRAFT_FIRST_INDEX];
  const call = stripParenExpression(write.expression);
  if (
    !isNodeOfType(next.id, "Identifier") ||
    !next.init ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !sameBinding(context, call.callee, setter) ||
    !sameBinding(context, call.arguments[RADIX_DRAFT_FIRST_INDEX], next.id)
  )
    return false;
  const value = stripParenExpression(next.init);
  if (isAppend) {
    if (
      !isNodeOfType(value, "ArrayExpression") ||
      value.elements.length !== RADIX_DRAFT_PAIR_COUNT ||
      !isNodeOfType(value.elements[RADIX_DRAFT_FIRST_INDEX], "SpreadElement") ||
      !value.elements[RADIX_DRAFT_SECOND_INDEX] ||
      !sameBinding(context, value.elements[RADIX_DRAFT_FIRST_INDEX].argument, state) ||
      !sameBinding(context, value.elements[RADIX_DRAFT_SECOND_INDEX], selectedValue)
    )
      return false;
  } else {
    if (
      !isNodeOfType(value, "CallExpression") ||
      value.optional ||
      value.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
      !isNodeOfType(value.callee, "MemberExpression") ||
      value.callee.computed ||
      value.callee.optional ||
      getStaticPropertyKeyName(value.callee) !== "filter" ||
      !sameBinding(context, value.callee.object, state)
    )
      return false;
    const predicate = value.arguments[RADIX_DRAFT_FIRST_INDEX];
    if (
      !isNodeOfType(predicate, "ArrowFunctionExpression") ||
      predicate.async ||
      predicate.params.length !== RADIX_DRAFT_SINGLE_COUNT ||
      !isNodeOfType(predicate.params[RADIX_DRAFT_FIRST_INDEX], "Identifier") ||
      !isNodeOfType(predicate.body, "BinaryExpression") ||
      predicate.body.operator !== "!==" ||
      !sameBinding(context, predicate.body.left, predicate.params[RADIX_DRAFT_FIRST_INDEX]) ||
      !sameBinding(context, predicate.body.right, selectedValue)
    )
      return false;
  }
  if (notification) {
    if (!isNodeOfType(notification, "ExpressionStatement")) return false;
    const notify = stripParenExpression(notification.expression);
    if (
      !isNodeOfType(notify, "CallExpression") ||
      !notify.optional ||
      !isNodeOfType(notify.callee, "Identifier") ||
      notify.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
      !sameBinding(context, notify.arguments[RADIX_DRAFT_FIRST_INDEX], next.id) ||
      !isFunctionLike(component) ||
      !isNodeOfType(component.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern")
    )
      return false;
    const parameter = context.scopes.symbolFor(notify.callee);
    if (
      !parameter ||
      parameter.kind !== "parameter" ||
      !isAstDescendant(parameter.bindingIdentifier, component.params[RADIX_DRAFT_FIRST_INDEX])
    )
      return false;
  }
  const nextSymbol = context.scopes.symbolFor(next.id);
  const program = findProgramRoot(next.id);
  return Boolean(
    nextSymbol &&
    program &&
    nextSymbol.kind === "const" &&
    hasCompleteSymbolReferences(nextSymbol, program, context.scopes) &&
    nextSymbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        (reference.identifier === call.arguments[RADIX_DRAFT_FIRST_INDEX] ||
          (notification && isAstDescendant(reference.identifier, notification))),
    ),
  );
};

export const hasSupportedRadixPendingDraft = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  effect: EsTreeNode,
  fact: EffectStateWriteFact,
): boolean => {
  const declaration = fact.stateDeclarator;
  const component = findEnclosingFunction(effect);
  if (
    !component ||
    !isFunctionLike(component) ||
    !isNodeOfType(component.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern") ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== RADIX_DRAFT_PAIR_COUNT ||
    !isNodeOfType(declaration.id.elements[RADIX_DRAFT_FIRST_INDEX], "Identifier") ||
    !isNodeOfType(declaration.id.elements[RADIX_DRAFT_SECOND_INDEX], "Identifier") ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !hasSupportedRadixReactCall(declaration.init, "useState", context.scopes) ||
    !hasSupportedRadixReactCall(effect, "useEffect", context.scopes)
  )
    return false;
  const [state, setter] = declaration.id.elements;
  if (!isNodeOfType(state, "Identifier") || !isNodeOfType(setter, "Identifier")) return false;
  const source = declaration.init.arguments[RADIX_DRAFT_FIRST_INDEX];
  if (
    !source ||
    !isNodeOfType(source, "Identifier") ||
    !isNodeOfType(fact.callExpression, "CallExpression") ||
    fact.callExpression.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !sameBinding(context, source, fact.callExpression.arguments[RADIX_DRAFT_FIRST_INDEX])
  )
    return false;
  const sourceSymbol = context.scopes.symbolFor(source);
  const setterSymbol = context.scopes.symbolFor(setter);
  const stateSymbol = context.scopes.symbolFor(state);
  if (
    !sourceSymbol ||
    sourceSymbol.kind !== "parameter" ||
    !isAstDescendant(sourceSymbol.bindingIdentifier, component.params[RADIX_DRAFT_FIRST_INDEX]) ||
    !setterSymbol ||
    !stateSymbol ||
    ![sourceSymbol, setterSymbol, stateSymbol].every(
      (symbol) =>
        hasCompleteSymbolReferences(symbol, analysis.programNode, context.scopes) &&
        symbol.references.every(
          (reference) =>
            reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
        ),
    )
  )
    return false;
  let writer: EsTreeNode | null = null;
  let extraWrites = RADIX_DRAFT_EMPTY_COUNT;
  for (const reference of setterSymbol.references) {
    const call = reference.identifier.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== reference.identifier ||
      call.optional
    )
      return false;
    if (call === fact.callExpression) continue;
    const owner = findEnclosingFunction(call);
    if (!owner || owner === component || (writer && writer !== owner)) return false;
    writer = owner;
    extraWrites += RADIX_DRAFT_SINGLE_COUNT;
  }
  if (
    !writer ||
    extraWrites !== RADIX_DRAFT_PAIR_COUNT ||
    !isFunctionLike(writer) ||
    writer.async ||
    writer.generator ||
    writer.params.length !== RADIX_DRAFT_PAIR_COUNT ||
    !isNodeOfType(writer.params[RADIX_DRAFT_FIRST_INDEX], "Identifier") ||
    !isNodeOfType(writer.params[RADIX_DRAFT_SECOND_INDEX], "Identifier") ||
    !isNodeOfType(writer.body, "BlockStatement") ||
    writer.body.body.length !== RADIX_DRAFT_THREE_STATEMENTS_COUNT
  )
    return false;
  const [preventDefault, undefinedGuard, toggle] = writer.body.body;
  if (!isNodeOfType(preventDefault, "ExpressionStatement")) return false;
  const preventCall = stripParenExpression(preventDefault.expression);
  if (
    !isNodeOfType(preventCall, "CallExpression") ||
    preventCall.optional ||
    preventCall.arguments.length !== RADIX_DRAFT_EMPTY_COUNT ||
    !isNodeOfType(preventCall.callee, "MemberExpression") ||
    preventCall.callee.computed ||
    getStaticPropertyKeyName(preventCall.callee) !== "preventDefault" ||
    !sameBinding(context, preventCall.callee.object, writer.params[RADIX_DRAFT_FIRST_INDEX]) ||
    !isNodeOfType(undefinedGuard, "IfStatement") ||
    undefinedGuard.alternate ||
    !isNodeOfType(undefinedGuard.test, "BinaryExpression") ||
    undefinedGuard.test.operator !== "===" ||
    !sameBinding(context, undefinedGuard.test.left, writer.params[RADIX_DRAFT_SECOND_INDEX]) ||
    !isNodeOfType(undefinedGuard.test.right, "Identifier") ||
    undefinedGuard.test.right.name !== "undefined" ||
    !context.scopes.isGlobalReference(undefinedGuard.test.right)
  )
    return false;
  const terminal =
    isNodeOfType(undefinedGuard.consequent, "BlockStatement") &&
    undefinedGuard.consequent.body.length === RADIX_DRAFT_SINGLE_COUNT
      ? undefinedGuard.consequent.body[RADIX_DRAFT_FIRST_INDEX]
      : undefinedGuard.consequent;
  if (
    !isNodeOfType(terminal, "ReturnStatement") ||
    terminal.argument ||
    !isNodeOfType(toggle, "IfStatement") ||
    !toggle.alternate ||
    !isNodeOfType(toggle.test, "CallExpression") ||
    toggle.test.optional ||
    toggle.test.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(toggle.test.callee, "MemberExpression") ||
    toggle.test.callee.computed ||
    getStaticPropertyKeyName(toggle.test.callee) !== "includes" ||
    !sameBinding(context, toggle.test.callee.object, state) ||
    !sameBinding(
      context,
      toggle.test.arguments[RADIX_DRAFT_FIRST_INDEX],
      writer.params[RADIX_DRAFT_SECOND_INDEX],
    ) ||
    !branchWritesDraft(
      toggle.consequent,
      state,
      setter,
      writer.params[RADIX_DRAFT_SECOND_INDEX],
      component,
      false,
      context,
    ) ||
    !branchWritesDraft(
      toggle.alternate,
      state,
      setter,
      writer.params[RADIX_DRAFT_SECOND_INDEX],
      component,
      true,
      context,
    )
  )
    return false;
  const identifier = getFunctionBindingIdentifier(writer);
  const writerSymbol = identifier && context.scopes.symbolFor(identifier);
  if (
    !writerSymbol ||
    writerSymbol.kind !== "const" ||
    !hasCompleteSymbolReferences(writerSymbol, analysis.programNode, context.scopes) ||
    writerSymbol.references.length === RADIX_DRAFT_EMPTY_COUNT ||
    !writerSymbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        isNodeOfType(reference.identifier.parent, "CallExpression") &&
        reference.identifier.parent.callee === reference.identifier &&
        hasSupportedRadixDraftEventCall(
          reference.identifier.parent,
          component,
          context,
          source,
          state,
        ),
    )
  )
    return false;
  return hasUserInputSetterWriter(analysis, context, fact.setterReference, effect, false, (call) =>
    hasSupportedRadixDraftEventCall(call, component, context, source, state),
  );
};
