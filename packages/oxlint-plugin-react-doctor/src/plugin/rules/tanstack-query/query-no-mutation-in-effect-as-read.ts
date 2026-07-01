import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

// The `mutate`/`mutateAsync` destructure keys are the near-unique TanStack
// mutation signature, so their presence identifies a mutation result even
// through custom hooks (`useUploadEvent`, `useListAvailableLocales`) and
// `useMutation as useGetXxx` aliases.
const isMutateKey = (name: string): boolean =>
  name === "mutate" || name === "mutateAsync";

// Reading only an acknowledgement field off the response (a genuine write
// confirming its result) is NOT a read-shaped query, so these never count
// as consuming the response body.
const ACK_FIELD_NAMES = new Set([
  "success",
  "error",
  "errors",
  "ok",
  "message",
  "status",
  "code",
]);

const findPatternPropertyBinding = (
  pattern: EsTreeNode,
  keyPredicate: (name: string) => boolean
): EsTreeNode | null => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) continue;
    if (
      !isNodeOfType(property.key, "Identifier") ||
      !keyPredicate(property.key.name)
    )
      continue;
    if (isNodeOfType(property.value, "Identifier")) return property.value;
  }
  return null;
};

// The destructure binding itself (`{ data }` / `{ data: rows }`) is recorded
// as a reference by the scope analyzer, so skip the pattern position — it is
// the declaration, not a consuming read.
const isDestructureBindingPosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent || !isNodeOfType(parent, "Property")) return false;
  return (
    Boolean(parent.parent) &&
    isNodeOfType(parent.parent as EsTreeNode, "ObjectPattern")
  );
};

const isAckMemberRead = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return (
    Boolean(parent) &&
    isNodeOfType(parent as EsTreeNode, "MemberExpression") &&
    (parent as EsTreeNodeOfType<"MemberExpression">).object === identifier &&
    !(parent as EsTreeNodeOfType<"MemberExpression">).computed &&
    isNodeOfType(
      (parent as EsTreeNodeOfType<"MemberExpression">).property,
      "Identifier"
    ) &&
    ACK_FIELD_NAMES.has(
      (
        (parent as EsTreeNodeOfType<"MemberExpression">)
          .property as EsTreeNodeOfType<"Identifier">
      ).name
    )
  );
};

// True when the binding's response body is actually consumed — returned,
// fed to a memo, rendered, or read field-by-field — rather than only
// checked for a success/error acknowledgement.
const symbolHasConsumerRead = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some(
    (reference) =>
      reference.flag !== "write" &&
      !isDestructureBindingPosition(reference.identifier) &&
      !isAckMemberRead(reference.identifier)
  );

const isInsideEffectCallback = (node: EsTreeNode): boolean => {
  let current = node.parent;
  while (current) {
    if (isHookCall(current, EFFECT_HOOK_NAMES)) return true;
    current = current.parent;
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
      const mutateSymbol = context.scopes.symbolFor(mutateBinding);
      if (!mutateSymbol) return;

      let mutateCalledInEffect = false;
      let awaitedResultConsumed = false;
      for (const reference of mutateSymbol.references) {
        const callNode = reference.identifier.parent;
        if (
          !callNode ||
          !isNodeOfType(callNode, "CallExpression") ||
          callNode.callee !== reference.identifier
        ) {
          continue;
        }
        if (!isInsideEffectCallback(callNode)) continue;
        mutateCalledInEffect = true;

        const awaitExpression = callNode.parent;
        if (
          !awaitExpression ||
          !isNodeOfType(awaitExpression, "AwaitExpression")
        )
          continue;
        const declarator = awaitExpression.parent;
        if (
          declarator &&
          isNodeOfType(declarator, "VariableDeclarator") &&
          isNodeOfType(declarator.id, "Identifier")
        ) {
          const resultSymbol = context.scopes.symbolFor(declarator.id);
          if (resultSymbol && symbolHasConsumerRead(resultSymbol))
            awaitedResultConsumed = true;
        }
      }
      if (!mutateCalledInEffect) return;

      const dataBinding = findPatternPropertyBinding(
        node.id,
        (name) => name === "data"
      );
      const dataSymbol = dataBinding
        ? context.scopes.symbolFor(dataBinding)
        : null;
      const dataConsumed = Boolean(
        dataSymbol && symbolHasConsumerRead(dataSymbol)
      );

      if (!dataConsumed && !awaitedResultConsumed) return;

      context.report({
        node: node.init,
        message:
          "This mutation is fired from `useEffect` and its response is read like a query, so it loses caching and refires on every dependency change — use `useQuery` instead.",
      });
    },
  }),
});
