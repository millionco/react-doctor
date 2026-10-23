import {
  RADIX_DRAFT_INHERITED_OBJECT_KEYS,
  RADIX_DRAFT_EMPTY_COUNT,
  RADIX_DRAFT_SINGLE_COUNT,
  RADIX_DRAFT_PAIR_COUNT,
  RADIX_DRAFT_THREE_STATEMENTS_COUNT,
  RADIX_DRAFT_FIRST_INDEX,
  RADIX_DRAFT_SECOND_INDEX,
} from "./constants.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isAbsentPropertyEmptyRecordGroup = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  presentProperties: ReadonlySet<string>,
): boolean => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(functionNode.params[RADIX_DRAFT_FIRST_INDEX], "Identifier") ||
    !isNodeOfType(functionNode.body, "BlockStatement") ||
    functionNode.body.body.length !== RADIX_DRAFT_PAIR_COUNT
  )
    return false;
  const [declaration, returned] = functionNode.body.body;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument
  )
    return false;
  const result = declaration.declarations[RADIX_DRAFT_FIRST_INDEX];
  if (!isNodeOfType(result.id, "Identifier") || !result.init) return false;
  const reduce = stripParenExpression(result.init);
  if (
    !isNodeOfType(reduce, "CallExpression") ||
    reduce.optional ||
    reduce.arguments.length !== RADIX_DRAFT_PAIR_COUNT ||
    !isNodeOfType(reduce.callee, "MemberExpression") ||
    reduce.callee.optional ||
    reduce.callee.computed ||
    getStaticPropertyKeyName(reduce.callee) !== "reduce" ||
    scopes.symbolFor(reduce.callee.object) !==
      scopes.symbolFor(functionNode.params[RADIX_DRAFT_FIRST_INDEX]) ||
    !isNodeOfType(reduce.arguments[RADIX_DRAFT_SECOND_INDEX], "ObjectExpression") ||
    reduce.arguments[RADIX_DRAFT_SECOND_INDEX].properties.length !== RADIX_DRAFT_EMPTY_COUNT
  )
    return false;
  const callback = reduce.arguments[RADIX_DRAFT_FIRST_INDEX];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== RADIX_DRAFT_PAIR_COUNT ||
    !isNodeOfType(callback.params[RADIX_DRAFT_FIRST_INDEX], "Identifier") ||
    !isNodeOfType(callback.params[RADIX_DRAFT_SECOND_INDEX], "Identifier") ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== RADIX_DRAFT_PAIR_COUNT
  )
    return false;
  const [guard, accumulatorReturn] = callback.body.body;
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "MemberExpression") ||
    guard.test.computed ||
    guard.test.optional ||
    scopes.symbolFor(guard.test.object) !==
      scopes.symbolFor(callback.params[RADIX_DRAFT_SECOND_INDEX]) ||
    !isNodeOfType(accumulatorReturn, "ReturnStatement") ||
    !accumulatorReturn.argument ||
    scopes.symbolFor(accumulatorReturn.argument) !==
      scopes.symbolFor(callback.params[RADIX_DRAFT_FIRST_INDEX])
  )
    return false;
  const absentProperty = getStaticPropertyKeyName(guard.test);
  if (
    !absentProperty ||
    presentProperties.has(absentProperty) ||
    RADIX_DRAFT_INHERITED_OBJECT_KEYS.has(absentProperty)
  )
    return false;
  if (
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== RADIX_DRAFT_THREE_STATEMENTS_COUNT
  )
    return false;
  const [categoryDeclaration, initialize, append] = guard.consequent.body;
  if (
    !isNodeOfType(categoryDeclaration, "VariableDeclaration") ||
    categoryDeclaration.kind !== "const" ||
    categoryDeclaration.declarations.length !== RADIX_DRAFT_SINGLE_COUNT
  )
    return false;
  const category = categoryDeclaration.declarations[RADIX_DRAFT_FIRST_INDEX];
  const categorySymbol = scopes.symbolFor(category.id);
  const isSlot = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "MemberExpression") &&
    node.computed &&
    !node.optional &&
    scopes.symbolFor(node.object) === scopes.symbolFor(callback.params[RADIX_DRAFT_FIRST_INDEX]) &&
    Boolean(categorySymbol && scopes.symbolFor(node.property) === categorySymbol);
  if (
    !isNodeOfType(category.id, "Identifier") ||
    !category.init ||
    !categorySymbol ||
    !isNodeOfType(category.init, "MemberExpression") ||
    category.init.computed ||
    category.init.optional ||
    getStaticPropertyKeyName(category.init) !== absentProperty ||
    scopes.symbolFor(category.init.object) !==
      scopes.symbolFor(callback.params[RADIX_DRAFT_SECOND_INDEX]) ||
    !isNodeOfType(initialize, "IfStatement") ||
    initialize.alternate ||
    !isNodeOfType(initialize.test, "UnaryExpression") ||
    initialize.test.operator !== "!" ||
    !isSlot(initialize.test.argument) ||
    !isNodeOfType(initialize.consequent, "BlockStatement") ||
    initialize.consequent.body.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(initialize.consequent.body[RADIX_DRAFT_FIRST_INDEX], "ExpressionStatement") ||
    !isNodeOfType(
      initialize.consequent.body[RADIX_DRAFT_FIRST_INDEX].expression,
      "AssignmentExpression",
    )
  )
    return false;
  const assignment = initialize.consequent.body[RADIX_DRAFT_FIRST_INDEX].expression;
  if (
    assignment.operator !== "=" ||
    !isSlot(assignment.left) ||
    !isNodeOfType(assignment.right, "ArrayExpression") ||
    assignment.right.elements.length !== RADIX_DRAFT_EMPTY_COUNT ||
    !isNodeOfType(append, "ExpressionStatement") ||
    !isNodeOfType(append.expression, "CallExpression") ||
    append.expression.optional ||
    append.expression.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    scopes.symbolFor(append.expression.arguments[RADIX_DRAFT_FIRST_INDEX]) !==
      scopes.symbolFor(callback.params[RADIX_DRAFT_SECOND_INDEX]) ||
    !isNodeOfType(append.expression.callee, "MemberExpression") ||
    append.expression.callee.computed ||
    append.expression.callee.optional ||
    getStaticPropertyKeyName(append.expression.callee) !== "push" ||
    !isSlot(append.expression.callee.object)
  )
    return false;
  const conditional = stripParenExpression(returned.argument);
  if (
    !isNodeOfType(conditional, "ConditionalExpression") ||
    !isNodeOfType(conditional.consequent, "Literal") ||
    conditional.consequent.value !== null ||
    scopes.symbolFor(conditional.alternate) !== scopes.symbolFor(result.id) ||
    !isNodeOfType(conditional.test, "BinaryExpression") ||
    conditional.test.operator !== "===" ||
    !isNodeOfType(conditional.test.right, "Literal") ||
    conditional.test.right.value !== RADIX_DRAFT_EMPTY_COUNT
  )
    return false;
  const length = conditional.test.left;
  if (
    !isNodeOfType(length, "MemberExpression") ||
    length.computed ||
    length.optional ||
    getStaticPropertyKeyName(length) !== "length" ||
    !isNodeOfType(length.object, "CallExpression") ||
    length.object.optional ||
    length.object.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    scopes.symbolFor(length.object.arguments[RADIX_DRAFT_FIRST_INDEX]) !==
      scopes.symbolFor(result.id) ||
    !isNodeOfType(length.object.callee, "MemberExpression") ||
    length.object.callee.computed ||
    length.object.callee.optional ||
    getStaticPropertyKeyName(length.object.callee) !== "keys" ||
    !isNodeOfType(length.object.callee.object, "Identifier") ||
    length.object.callee.object.name !== "Object" ||
    !scopes.isGlobalReference(length.object.callee.object)
  )
    return false;
  const program = findProgramRoot(functionNode);
  const input = scopes.symbolFor(functionNode.params[RADIX_DRAFT_FIRST_INDEX]);
  const output = scopes.symbolFor(result.id);
  const accumulator = scopes.symbolFor(callback.params[RADIX_DRAFT_FIRST_INDEX]);
  const option = scopes.symbolFor(callback.params[RADIX_DRAFT_SECOND_INDEX]);
  if (!program || !input || !output || !accumulator || !option) return false;
  if (
    ![input, output, accumulator, option, categorySymbol].every(
      (symbol) =>
        hasCompleteSymbolReferences(symbol, program, scopes) &&
        symbol.references.every((reference) => reference.flag === "read"),
    )
  )
    return false;
  const reducedOptions = reduce.callee.object;
  if (!input.references.every((reference) => reference.identifier === reducedOptions)) return false;
  const testedOption = guard.test.object;
  const categoryRead = category.init;
  const appendedOption = append.expression.arguments[RADIX_DRAFT_FIRST_INDEX];
  const keysArgument = length.object.arguments[RADIX_DRAFT_FIRST_INDEX];
  const slotNodes = [initialize.test.argument, assignment.left, append.expression.callee.object];
  if (
    !accumulator.references.every(
      (reference) =>
        reference.identifier === accumulatorReturn.argument ||
        slotNodes.some(
          (slot) => isNodeOfType(slot, "MemberExpression") && slot.object === reference.identifier,
        ),
    ) ||
    !option.references.every(
      (reference) =>
        reference.identifier === testedOption ||
        reference.identifier === categoryRead.object ||
        reference.identifier === appendedOption,
    ) ||
    !categorySymbol.references.every((reference) =>
      slotNodes.some(
        (slot) => isNodeOfType(slot, "MemberExpression") && slot.property === reference.identifier,
      ),
    )
  )
    return false;
  return output.references.every(
    (reference) =>
      reference.identifier === conditional.alternate || reference.identifier === keysArgument,
  );
};
