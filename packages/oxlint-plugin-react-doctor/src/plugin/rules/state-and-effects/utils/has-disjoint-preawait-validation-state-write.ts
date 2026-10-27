import { hasPlainValidationInputData } from "./has-plain-validation-input-data.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getOwnDataObjectProperties } from "../../../utils/get-own-data-object-properties.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isReactHookResultReference } from "../../../utils/is-react-hook-result-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasReadonlyAsyncEventBinding } from "./has-readonly-async-event-binding.js";
import type { AsyncEventSourceModule } from "./has-readonly-async-event-binding.js";
import {
  OWN_HOOK_FIRST_INDEX,
  OWN_HOOK_SINGLE_COUNT,
  CANONICAL_CONTROL_PAIR_COUNT,
  OWN_HOOK_STATE_API_NAMES,
  OWN_HOOK_UNSUPPORTED_PREAWAIT_NODES,
} from "./constants.js";

interface OwnedHookValidationStateInput {
  readonly handler: EsTreeNode;
  readonly unsafeAwait: EsTreeNode;
  readonly validationCalls: ReadonlySet<EsTreeNodeOfType<"CallExpression">>;
  readonly module: AsyncEventSourceModule;
}

interface OwnedHookValidationResult {
  readonly result: SymbolDescriptor;
  readonly state: SymbolDescriptor;
  readonly setter: SymbolDescriptor;
  readonly inputField: string;
}

export const hasDisjointPreawaitValidationStateWrite = ({
  handler,
  unsafeAwait,
  validationCalls,
  module,
}: OwnedHookValidationStateInput): boolean => {
  if (!isFunctionLike(handler) || !isNodeOfType(handler.body, "BlockStatement")) return false;
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  let mutableInput = false;
  const gateTests: EsTreeNode[] = [];
  const allowedGates = new Set<EsTreeNode>();
  const request = isNodeOfType(unsafeAwait, "AwaitExpression")
    ? stripParenExpression(unsafeAwait.argument)
    : null;
  if (!request) return false;
  walkAst(handler.body, (node) => {
    if (node !== handler.body && isFunctionLike(node)) return false;
    if (node.range[OWN_HOOK_FIRST_INDEX] >= unsafeAwait.range[OWN_HOOK_SINGLE_COUNT]) return false;
    if (OWN_HOOK_UNSUPPORTED_PREAWAIT_NODES.has(node.type)) mutableInput = true;
    if (isNodeOfType(node, "IfStatement")) gateTests.push(stripParenExpression(node.test));
    if (isNodeOfType(node, "CallExpression")) calls.push(node);
  });
  const results: OwnedHookValidationResult[] = [];
  const allowedResults = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  const inputSymbols = new Set<SymbolDescriptor>();
  for (const invocation of validationCalls) {
    const root = findTransparentExpressionRoot(invocation);
    const declaration = root.parent;
    if (
      !calls.includes(invocation) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== root ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.kind !== "const" ||
      declaration.parent.parent !== handler.body ||
      invocation.arguments.length !== OWN_HOOK_SINGLE_COUNT
    )
      return false;
    const result = module.scopes.symbolFor(declaration.id);
    if (!result || !hasReadonlyAsyncEventBinding(result, module)) return false;
    let input = stripParenExpression(invocation.arguments[OWN_HOOK_FIRST_INDEX]);
    const seen = new Set<SymbolDescriptor>();
    while (isNodeOfType(input, "Identifier")) {
      const symbol = module.scopes.symbolFor(input);
      const binding = symbol?.declarationNode;
      if (
        !symbol ||
        seen.has(symbol) ||
        symbol.kind !== "const" ||
        !hasReadonlyAsyncEventBinding(symbol, module) ||
        !isNodeOfType(binding, "VariableDeclarator") ||
        binding.id !== symbol.bindingIdentifier ||
        !binding.init ||
        binding.range[OWN_HOOK_FIRST_INDEX] >= invocation.range[OWN_HOOK_FIRST_INDEX]
      )
        return false;
      seen.add(symbol);
      inputSymbols.add(symbol);
      input = stripParenExpression(binding.init);
    }
    if (!isNodeOfType(input, "MemberExpression") || input.computed || input.optional) return false;
    const stateReceiver = stripParenExpression(input.object);
    if (!isNodeOfType(stateReceiver, "Identifier")) return false;
    const state = module.scopes.symbolFor(stateReceiver);
    const stateDeclaration = state?.declarationNode;
    const inputField = getStaticPropertyName(input);
    if (
      !state ||
      !inputField ||
      state.kind !== "const" ||
      !hasReadonlyAsyncEventBinding(state, module) ||
      !isNodeOfType(stateDeclaration, "VariableDeclarator") ||
      !isNodeOfType(stateDeclaration.id, "ArrayPattern") ||
      stateDeclaration.id.elements[OWN_HOOK_FIRST_INDEX] !== state.bindingIdentifier ||
      !isNodeOfType(stateDeclaration.id.elements[OWN_HOOK_SINGLE_COUNT], "Identifier")
    )
      return false;
    const pair = resolveReactUseStatePair(
      stateDeclaration.id.elements[OWN_HOOK_SINGLE_COUNT],
      module.scopes,
    );
    if (
      !pair ||
      pair.stateSymbol !== state ||
      pair.setterSymbol.kind !== "const" ||
      !hasReadonlyAsyncEventBinding(pair.setterSymbol, module) ||
      !isNodeOfType(pair.declarator.init, "CallExpression") ||
      !isProvenUnmodifiedReactApiCall(pair.declarator.init, "useState", module.scopes)
    )
      return false;
    const initial = pair.declarator.init.arguments[OWN_HOOK_FIRST_INDEX];
    const initialInput = initial
      ? getOwnDataObjectProperties(stripParenExpression(initial))?.get(inputField)
      : null;
    if (!initialInput || !hasPlainValidationInputData({ value: initialInput, module }))
      return false;
    inputSymbols.add(state);
    results.push({ result, state, setter: pair.setterSymbol, inputField });
    allowedResults.set(result, new Set());
  }
  const inspectInput = (symbol: SymbolDescriptor, seen = new Set<SymbolDescriptor>()): boolean => {
    if (seen.has(symbol) || !hasReadonlyAsyncEventBinding(symbol, module)) return false;
    seen.add(symbol);
    for (const reference of symbol.references) {
      if (
        reference.identifier === symbol.bindingIdentifier ||
        isTypeScriptTypePosition(reference.identifier) ||
        isNonReferenceIdentifier(reference.identifier)
      )
        continue;
      let value = findTransparentExpressionRoot(reference.identifier);
      while (isNodeOfType(value.parent, "MemberExpression") && value.parent.object === value)
        value = findTransparentExpressionRoot(value.parent);
      if (isMemberMutationTarget(value)) return false;
      const parent = value.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === value &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const alias = module.scopes.symbolFor(parent.id);
        if (!alias || alias.kind !== "const" || !inspectInput(alias, seen)) return false;
        continue;
      }
      if (
        isNodeOfType(parent, "Property") &&
        parent.value === value &&
        isNodeOfType(parent.parent, "ObjectExpression") &&
        isNodeOfType(parent.parent.parent, "ReturnStatement") &&
        findEnclosingFunction(parent) === findEnclosingFunction(handler)
      )
        continue;
      if (isNodeOfType(parent, "CallExpression")) {
        if (parent.callee === value) return false;
        if (validationCalls.has(parent)) continue;
        const callee = stripParenExpression(parent.callee);
        if (!isNodeOfType(callee, "MemberExpression")) return false;
        const receiver = stripParenExpression(callee.object);
        if (
          getStaticPropertyName(callee) !== "stringify" ||
          !isNodeOfType(receiver, "Identifier") ||
          receiver.name !== "JSON" ||
          !module.scopes.isGlobalReference(receiver) ||
          parent.arguments.length !== OWN_HOOK_SINGLE_COUNT
        )
          return false;
        continue;
      }
      return false;
    }
    return true;
  };
  for (const symbol of inputSymbols) if (!inspectInput(symbol)) mutableInput = true;
  if (mutableInput) return false;
  const eventParameter = handler.params[OWN_HOOK_FIRST_INDEX];
  const eventSymbol = isNodeOfType(eventParameter, "Identifier")
    ? module.scopes.symbolFor(eventParameter)
    : null;
  for (const call of calls) {
    if (validationCalls.has(call) || call === request) continue;
    const callee = stripParenExpression(call.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      isReactHookResultReference(
        callee,
        OWN_HOOK_STATE_API_NAMES,
        OWN_HOOK_SINGLE_COUNT,
        module.scopes,
      )
    ) {
      const setter = module.scopes.symbolFor(callee);
      const matching = results.filter((result) => result.setter === setter);
      if (
        !matching.length ||
        call.arguments.length !== OWN_HOOK_SINGLE_COUNT ||
        !isNodeOfType(call.parent, "ExpressionStatement") ||
        call.parent.parent !== handler.body
      )
        return false;
      const updater = stripParenExpression(call.arguments[OWN_HOOK_FIRST_INDEX]);
      if (
        !isNodeOfType(updater, "ArrowFunctionExpression") ||
        updater.async ||
        updater.params.length !== OWN_HOOK_SINGLE_COUNT ||
        !isNodeOfType(updater.params[OWN_HOOK_FIRST_INDEX], "Identifier")
      )
        return false;
      const previous = module.scopes.symbolFor(updater.params[OWN_HOOK_FIRST_INDEX]);
      const rawReturn = getSingleReturnExpression(updater);
      const returned = rawReturn ? stripParenExpression(rawReturn) : null;
      if (
        !previous ||
        !isNodeOfType(returned, "ObjectExpression") ||
        returned.properties.length !== CANONICAL_CONTROL_PAIR_COUNT
      )
        return false;
      const [spread, property] = returned.properties;
      if (
        !isNodeOfType(spread, "SpreadElement") ||
        !isNodeOfType(spread.argument, "Identifier") ||
        module.scopes.symbolFor(spread.argument) !== previous ||
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      )
        return false;
      const key = getStaticPropertyKeyName(property);
      const value = stripParenExpression(property.value);
      const result = matching.find(
        (candidate) =>
          candidate.inputField !== key &&
          isNodeOfType(value, "Identifier") &&
          module.scopes.symbolFor(value) === candidate.result,
      );
      if (
        !key ||
        key === "__proto__" ||
        !result ||
        !hasOnlyAllowedSymbolReads({
          symbol: previous,
          allowedIdentifiers: new Set([spread.argument]),
          program: module.program,
          scopes: module.scopes,
        })
      )
        return false;
      allowedResults.get(result.result)?.add(value);
      continue;
    }
    if (!isNodeOfType(callee, "MemberExpression") || callee.optional || call.optional) return false;
    const callReceiver = stripParenExpression(callee.object);
    if (
      getStaticPropertyName(callee) === "preventDefault" &&
      isNodeOfType(callReceiver, "Identifier") &&
      module.scopes.symbolFor(callReceiver) === eventSymbol &&
      call.arguments.length === OWN_HOOK_FIRST_INDEX
    )
      continue;
    if (
      getStaticPropertyName(callee) === "stringify" &&
      isNodeOfType(callReceiver, "Identifier") &&
      callReceiver.name === "JSON" &&
      module.scopes.isGlobalReference(callReceiver) &&
      call.arguments.length === OWN_HOOK_SINGLE_COUNT
    ) {
      const value = stripParenExpression(call.arguments[OWN_HOOK_FIRST_INDEX]);
      const inputSymbol = isNodeOfType(value, "Identifier") ? module.scopes.symbolFor(value) : null;
      if (inputSymbol && inputSymbols.has(inputSymbol)) continue;
      if (isNodeOfType(value, "MemberExpression")) {
        const receiver = stripParenExpression(value.object);
        if (
          isNodeOfType(receiver, "Identifier") &&
          results.some(
            (result) =>
              module.scopes.symbolFor(receiver) === result.state &&
              getStaticPropertyName(value) === result.inputField,
          )
        )
          continue;
      }
      return false;
    }
    if (
      getStaticPropertyName(callee) === "values" &&
      isNodeOfType(callReceiver, "Identifier") &&
      callReceiver.name === "Object" &&
      module.scopes.isGlobalReference(callReceiver) &&
      call.arguments.length === OWN_HOOK_SINGLE_COUNT
    ) {
      const value = stripParenExpression(call.arguments[OWN_HOOK_FIRST_INDEX]);
      const result = results.find(
        (result) =>
          isNodeOfType(value, "Identifier") && module.scopes.symbolFor(value) === result.result,
      );
      if (!result) return false;
      allowedResults.get(result.result)?.add(value);
      continue;
    }
    if (
      getStaticPropertyName(callee) === "every" &&
      isNodeOfType(stripParenExpression(callee.object), "CallExpression") &&
      call.arguments.length === OWN_HOOK_SINGLE_COUNT
    ) {
      const receiver = stripParenExpression(callee.object);
      if (
        !isNodeOfType(receiver, "CallExpression") ||
        !calls.includes(receiver) ||
        !isNodeOfType(receiver.callee, "MemberExpression") ||
        getStaticPropertyName(receiver.callee) !== "values"
      )
        return false;
      const predicate = stripParenExpression(call.arguments[OWN_HOOK_FIRST_INDEX]);
      if (
        !isNodeOfType(predicate, "ArrowFunctionExpression") ||
        predicate.async ||
        predicate.params.length !== OWN_HOOK_SINGLE_COUNT ||
        !isNodeOfType(predicate.params[OWN_HOOK_FIRST_INDEX], "Identifier")
      )
        return false;
      const predicateReturn = getSingleReturnExpression(predicate);
      if (!predicateReturn) return false;
      const expression = stripParenExpression(predicateReturn);
      const parameter = module.scopes.symbolFor(predicate.params[OWN_HOOK_FIRST_INDEX]);
      if (
        !parameter ||
        !isNodeOfType(expression, "BinaryExpression") ||
        expression.operator !== "===" ||
        !isNodeOfType(expression.left, "Identifier") ||
        module.scopes.symbolFor(expression.left) !== parameter ||
        !isNodeOfType(expression.right, "Literal") ||
        expression.right.value !== "" ||
        !hasOnlyAllowedSymbolReads({
          symbol: parameter,
          allowedIdentifiers: new Set([expression.left]),
          program: module.program,
          scopes: module.scopes,
        })
      )
        return false;
      allowedGates.add(call);
      continue;
    }
    return false;
  }
  if (gateTests.some((test) => !allowedGates.has(test))) return false;
  for (const [symbol, allowed] of allowedResults) {
    for (const reference of symbol.references)
      if (
        reference.identifier.range[OWN_HOOK_FIRST_INDEX] <
          unsafeAwait.range[OWN_HOOK_SINGLE_COUNT] &&
        reference.identifier !== symbol.bindingIdentifier &&
        !isTypeScriptTypePosition(reference.identifier) &&
        !isNonReferenceIdentifier(reference.identifier) &&
        !allowed.has(reference.identifier)
      )
        return false;
  }
  return true;
};
