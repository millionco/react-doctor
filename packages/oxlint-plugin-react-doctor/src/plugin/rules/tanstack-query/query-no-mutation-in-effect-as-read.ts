import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

// The `mutate`/`mutateAsync` destructure keys are the near-unique TanStack
// mutation signature, so their presence identifies a mutation result even
// through custom hooks (`useUploadEvent`, `useListAvailableLocales`) and
// `useMutation as useGetXxx` aliases.
const isMutateKey = (name: string): boolean => name === "mutate" || name === "mutateAsync";

// Reading only an acknowledgement field off the response (a genuine write
// confirming its result) is NOT a read-shaped query, so these never count
// as consuming the response body.
const ACK_FIELD_NAMES = new Set(["success", "error", "errors", "ok", "message", "status", "code"]);

// SWR's `const { data, mutate } = useSWR(...)` matches the destructure keys,
// but there `mutate` is the bound revalidate function — calling it in an
// effect while rendering `data` is idiomatic SWR, not a mutation-as-read.
const SWR_HOOK_NAME_PATTERN = /^useSWR/;
const SWR_MODULE_SOURCE_PATTERN = /^swr(\/|$)/;

const NULLISH_COMPARISON_OPERATORS = new Set(["==", "!=", "===", "!=="]);

const findPatternPropertyBinding = (
  pattern: EsTreeNode,
  keyPredicate: (name: string) => boolean,
): EsTreeNode | null => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) continue;
    if (!isNodeOfType(property.key, "Identifier") || !keyPredicate(property.key.name)) continue;
    if (isNodeOfType(property.value, "Identifier")) return property.value;
  }
  return null;
};

const isSwrHookResult = (init: EsTreeNodeOfType<"CallExpression">): boolean => {
  const calleeName = getCalleeName(init);
  if (!calleeName) return false;
  if (SWR_HOOK_NAME_PATTERN.test(calleeName)) return true;
  const importSource = getImportSourceForName(init, calleeName);
  return Boolean(importSource && SWR_MODULE_SOURCE_PATTERN.test(importSource));
};

// The destructure binding itself (`{ data }` / `{ data: rows }`) is recorded
// as a reference by the scope analyzer, so skip the pattern position — it is
// the declaration, not a consuming read.
const isDestructureBindingPosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent || !isNodeOfType(parent, "Property")) return false;
  return Boolean(parent.parent) && isNodeOfType(parent.parent as EsTreeNode, "ObjectPattern");
};

const isAckMemberRead = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return (
    Boolean(parent) &&
    isNodeOfType(parent as EsTreeNode, "MemberExpression") &&
    (parent as EsTreeNodeOfType<"MemberExpression">).object === identifier &&
    !(parent as EsTreeNodeOfType<"MemberExpression">).computed &&
    isNodeOfType((parent as EsTreeNodeOfType<"MemberExpression">).property, "Identifier") &&
    ACK_FIELD_NAMES.has(
      ((parent as EsTreeNodeOfType<"MemberExpression">).property as EsTreeNodeOfType<"Identifier">)
        .name,
    )
  );
};

const isNullishOperand = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") && node.value === null) ||
  (isNodeOfType(node, "Identifier") && node.name === "undefined");

// A bare truthiness/nullish guard (`!data`, `data && ...`, `data ? ... : ...`,
// `if (data)`, `Boolean(data)`, `data != null`) checks that the response
// exists — the pre-optional-chaining spelling of `data?.x` — and does not
// consume the response body.
const isGuardOnlyRead = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return true;
  if (isNodeOfType(parent, "LogicalExpression") && parent.operator === "&&") {
    return parent.left === identifier;
  }
  if (isNodeOfType(parent, "ConditionalExpression")) return parent.test === identifier;
  if (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "WhileStatement")) {
    return parent.test === identifier;
  }
  if (
    isNodeOfType(parent, "CallExpression") &&
    isNodeOfType(parent.callee, "Identifier") &&
    parent.callee.name === "Boolean"
  ) {
    return parent.callee !== identifier;
  }
  if (
    isNodeOfType(parent, "BinaryExpression") &&
    NULLISH_COMPARISON_OPERATORS.has(parent.operator)
  ) {
    const otherOperand = parent.left === identifier ? parent.right : parent.left;
    return isNullishOperand(otherOperand);
  }
  return false;
};

// True when the binding's response body is actually consumed — returned,
// fed to a memo, rendered, or read field-by-field — rather than only
// checked for existence or a success/error acknowledgement.
const symbolHasConsumerRead = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some(
    (reference) =>
      reference.flag !== "write" &&
      !isDestructureBindingPosition(reference.identifier) &&
      !isAckMemberRead(reference.identifier) &&
      !isGuardOnlyRead(reference.identifier),
  );

const objectPatternReadsResponseBody = (pattern: EsTreeNodeOfType<"ObjectPattern">): boolean =>
  pattern.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      !ACK_FIELD_NAMES.has(property.key.name),
  );

// oxc-parser surfaces `(...)` as a `ParenthesizedExpression`, a node kind
// outside the TSESTree union, so it is matched by string here.
const GROUPING_PARENS_TYPE: string = "ParenthesizedExpression";

const skipGroupingParensUpward = (node: EsTreeNode): EsTreeNode | null | undefined => {
  let current = node.parent;
  while (current && current.type === GROUPING_PARENS_TYPE) current = current.parent;
  return current;
};

// Only calls on the effect callback's own execution path count as "fired from
// useEffect" — crossing an immediately-invoked wrapper is fine, but a handler
// merely *registered* in the effect (socket listener, interval, observer)
// fires per external event, not on dependency changes.
const isInvokedFromEffectBody = (node: EsTreeNode): boolean => {
  let current = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      const enclosingCall = skipGroupingParensUpward(current);
      if (!enclosingCall || !isNodeOfType(enclosingCall, "CallExpression")) return false;
      if (isHookCall(enclosingCall, EFFECT_HOOK_NAMES)) {
        const effectCallback = enclosingCall.arguments[0];
        return Boolean(effectCallback) && stripGroupingParens(effectCallback) === current;
      }
      if (stripGroupingParens(enclosingCall.callee) !== current) return false;
    }
    current = current.parent;
  }
  return false;
};

const awaitedResultConsumesResponse = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const awaitExpression = callNode.parent;
  if (!awaitExpression || !isNodeOfType(awaitExpression, "AwaitExpression")) return false;
  const declarator = awaitExpression.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (isNodeOfType(declarator.id, "Identifier")) {
    const resultSymbol = context.scopes.symbolFor(declarator.id);
    return Boolean(resultSymbol && symbolHasConsumerRead(resultSymbol));
  }
  if (isNodeOfType(declarator.id, "ObjectPattern")) {
    return objectPatternReadsResponseBody(declarator.id);
  }
  return false;
};

const thenHandlerConsumesResponse = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const memberExpression = callNode.parent;
  if (
    !memberExpression ||
    !isNodeOfType(memberExpression, "MemberExpression") ||
    memberExpression.object !== callNode ||
    memberExpression.computed ||
    !isNodeOfType(memberExpression.property, "Identifier") ||
    memberExpression.property.name !== "then"
  ) {
    return false;
  }
  const thenCall = memberExpression.parent;
  if (
    !thenCall ||
    !isNodeOfType(thenCall, "CallExpression") ||
    thenCall.callee !== memberExpression
  ) {
    return false;
  }
  const handlerArgument = thenCall.arguments[0];
  if (!handlerArgument) return false;
  const handler = stripGroupingParens(handlerArgument);
  if (!isFunctionLike(handler)) return false;
  const responseParam = handler.params[0];
  if (!responseParam) return false;
  if (isNodeOfType(responseParam, "Identifier")) {
    const responseSymbol = context.scopes.symbolFor(responseParam);
    return Boolean(responseSymbol && symbolHasConsumerRead(responseSymbol));
  }
  if (isNodeOfType(responseParam, "ObjectPattern")) {
    return objectPatternReadsResponseBody(responseParam);
  }
  return false;
};

export const queryNoMutationInEffectAsRead = defineRule({
  id: "query-no-mutation-in-effect-as-read",
  title: "Mutation driven from an effect as a read",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Use `useQuery` with a `queryKey` and `enabled` for GET-shaped reads instead of firing a mutation from `useEffect`, so the response is cached and deduplicated.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init || !isNodeOfType(node.init, "CallExpression")) return;
      const mutateBinding = findPatternPropertyBinding(node.id, isMutateKey);
      if (!mutateBinding) return;
      if (isSwrHookResult(node.init)) return;
      const mutateSymbol = context.scopes.symbolFor(mutateBinding);
      if (!mutateSymbol) return;

      let mutateCalledInEffect = false;
      let effectResultConsumed = false;
      for (const reference of mutateSymbol.references) {
        const callNode = reference.identifier.parent;
        if (
          !callNode ||
          !isNodeOfType(callNode, "CallExpression") ||
          callNode.callee !== reference.identifier
        ) {
          continue;
        }
        if (!isInvokedFromEffectBody(callNode)) continue;
        mutateCalledInEffect = true;
        if (
          awaitedResultConsumesResponse(callNode, context) ||
          thenHandlerConsumesResponse(callNode, context)
        ) {
          effectResultConsumed = true;
        }
      }
      if (!mutateCalledInEffect) return;

      const dataBinding = findPatternPropertyBinding(node.id, (name) => name === "data");
      const dataSymbol = dataBinding ? context.scopes.symbolFor(dataBinding) : null;
      const dataConsumed = Boolean(dataSymbol && symbolHasConsumerRead(dataSymbol));

      if (!dataConsumed && !effectResultConsumed) return;

      context.report({
        node: node.init,
        message:
          "This mutation is fired from `useEffect` and its response is read like a query, so it loses caching and refires on every dependency change — use `useQuery` instead.",
      });
    },
  }),
});
