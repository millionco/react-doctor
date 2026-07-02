import { defineRule } from "../../utils/define-rule.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

// HACK: jotai-tanstack-query's `atomWithQuery` returns an atom whose
// value is the full `QueryObserverResult` envelope. TanStack rebuilds
// that envelope on every observer notify, including no-op refetches.
// Subscribing directly via `useAtomValue(queryAtom)` puts every
// consumer on the broadcast path and re-renders them every notify,
// even when the field they actually read didn't change. Measured:
// 44× more commits than the equivalent `useQuery` consumer.
// Fix: derive the field once, then subscribe to the derived atom.
//   const dataAtom = atom((get) => get(queryAtom).data)
//   const data = useAtomValue(dataAtom)
// `atomWithMutation` is excluded because there's no observer envelope —
// the result IS the imperative trigger and subscribing to it is the
// documented API. `atomWithSuspenseQuery` and `atomWithInfiniteQuery`
// share the same envelope-on-every-notify shape as `atomWithQuery`.

const QUERY_ATOM_FACTORY_IMPORTED_NAMES = new Set([
  "atomWithQuery",
  "atomWithSuspenseQuery",
  "atomWithInfiniteQuery",
  "atomWithSuspenseInfiniteQuery",
]);

const SUBSCRIBING_HOOK_NAMES = new Set(["useAtomValue", "useAtom"]);

// Atoms usually live in a separate atoms module, so a name-only
// heuristic is needed for imports. The `*QueryAtom` suffix alone is
// not enough — `searchQueryAtom` is a mainstream name for a plain
// `atom('')` holding a search-query string — so the cross-file path
// additionally requires the hook result to be consumed as a
// `QueryObserverResult` envelope (see ENVELOPE_FIELD_NAMES).
const QUERY_ATOM_NAME_PATTERN = /QueryAtom$/;

// Package sources whose exports are factories/hooks, never user atoms.
const NON_ATOM_IMPORT_SOURCES = new Set(["jotai", "jotai/react", "jotai-tanstack-query"]);

const ENVELOPE_FIELD_NAMES = new Set([
  "data",
  "error",
  "status",
  "fetchStatus",
  "isLoading",
  "isError",
  "isPending",
  "isSuccess",
  "isFetching",
  "refetch",
]);

const patternDestructuresEnvelopeField = (pattern: EsTreeNode): boolean =>
  isNodeOfType(pattern, "ObjectPattern") &&
  (pattern.properties ?? []).some(
    (property) =>
      isNodeOfType(property, "Property") &&
      isNodeOfType(property.key, "Identifier") &&
      ENVELOPE_FIELD_NAMES.has(property.key.name),
  );

const isEnvelopeMemberAccess = (memberExpression: EsTreeNode): boolean =>
  isNodeOfType(memberExpression, "MemberExpression") &&
  !memberExpression.computed &&
  isNodeOfType(memberExpression.property, "Identifier") &&
  ENVELOPE_FIELD_NAMES.has(memberExpression.property.name);

const bindingIsConsumedAsEnvelope = (
  bindingIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(bindingIdentifier);
  if (!symbol) return false;
  return symbol.references.some((reference) => {
    const referenceParent = reference.identifier.parent;
    if (
      isNodeOfType(referenceParent, "MemberExpression") &&
      referenceParent.object === reference.identifier
    ) {
      return isEnvelopeMemberAccess(referenceParent);
    }
    if (
      isNodeOfType(referenceParent, "VariableDeclarator") &&
      referenceParent.init === reference.identifier
    ) {
      return patternDestructuresEnvelopeField(referenceParent.id);
    }
    return false;
  });
};

// Whether the subscribe call's result is read as the query envelope:
// `useAtomValue(a).data`, `const { data } = useAtomValue(a)`,
// `const result = useAtomValue(a); result.isLoading`, and the
// `const [result] = useAtom(a)` tuple equivalents.
const isHookResultConsumedAsEnvelope = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  hookName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callParent = callNode.parent;
  if (hookName === "useAtomValue") {
    if (isNodeOfType(callParent, "MemberExpression") && callParent.object === callNode) {
      return isEnvelopeMemberAccess(callParent);
    }
    if (isNodeOfType(callParent, "VariableDeclarator") && callParent.init === callNode) {
      if (patternDestructuresEnvelopeField(callParent.id)) return true;
      if (isNodeOfType(callParent.id, "Identifier")) {
        return bindingIsConsumedAsEnvelope(callParent.id, scopes);
      }
    }
    return false;
  }
  if (!isNodeOfType(callParent, "VariableDeclarator") || callParent.init !== callNode) {
    return false;
  }
  if (!isNodeOfType(callParent.id, "ArrayPattern")) return false;
  const valueElement = callParent.id.elements?.[0];
  if (!valueElement) return false;
  if (patternDestructuresEnvelopeField(valueElement)) return true;
  if (isNodeOfType(valueElement, "Identifier")) {
    return bindingIsConsumedAsEnvelope(valueElement, scopes);
  }
  return false;
};

interface SubscribeCallCandidate {
  callNode: EsTreeNodeOfType<"CallExpression">;
  hookName: string;
  atomName: string;
}

export const jotaiTqUseRawQueryAtom = defineRule({
  id: "jotai-tq-use-raw-query-atom",
  title: "Subscribing to raw query atom",
  severity: "warn",
  recommendation:
    "Derive the field you read: `const dataAtom = atom((get) => get(queryAtom).data)`. Subscribing to the whole query atom re-renders on every refetch, focus, or no-op cache hit.",
  create: (context: RuleContext) => {
    const queryAtomFactoryLocalNames = new Set<string>();
    const queryAtomBindingNames = new Set<string>();
    const importedQueryAtomNames = new Set<string>();
    const factoryCallDeclarators: EsTreeNodeOfType<"VariableDeclarator">[] = [];
    const subscribeCallCandidates: SubscribeCallCandidate[] = [];

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;
        if (typeof source !== "string") return;
        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          if (!isNodeOfType(specifier.local, "Identifier")) continue;
          if (source === "jotai-tanstack-query") {
            const importedName = getImportedName(specifier);
            if (importedName && QUERY_ATOM_FACTORY_IMPORTED_NAMES.has(importedName)) {
              queryAtomFactoryLocalNames.add(specifier.local.name);
            }
            continue;
          }
          if (NON_ATOM_IMPORT_SOURCES.has(source)) continue;
          if (QUERY_ATOM_NAME_PATTERN.test(specifier.local.name)) {
            importedQueryAtomNames.add(specifier.local.name);
          }
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        const initializer: EsTreeNode | null | undefined = node.init;
        if (!isNodeOfType(initializer, "CallExpression")) return;
        if (!isNodeOfType(initializer.callee, "Identifier")) return;
        factoryCallDeclarators.push(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (!SUBSCRIBING_HOOK_NAMES.has(node.callee.name)) return;
        const firstArgument = (node.arguments ?? [])[0];
        if (!isNodeOfType(firstArgument, "Identifier")) return;
        subscribeCallCandidates.push({
          callNode: node,
          hookName: node.callee.name,
          atomName: firstArgument.name,
        });
      },
      // Decide only after the whole file is seen — a component defined
      // ABOVE the `atomWithQuery(...)` declaration must still resolve.
      "Program:exit"() {
        for (const declarator of factoryCallDeclarators) {
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          if (!isNodeOfType(declarator.init.callee, "Identifier")) continue;
          if (!queryAtomFactoryLocalNames.has(declarator.init.callee.name)) continue;
          queryAtomBindingNames.add(declarator.id.name);
        }
        for (const candidate of subscribeCallCandidates) {
          const isFileLocalQueryAtom = queryAtomBindingNames.has(candidate.atomName);
          const isImportedQueryAtom =
            importedQueryAtomNames.has(candidate.atomName) &&
            isHookResultConsumedAsEnvelope(candidate.callNode, candidate.hookName, context.scopes);
          if (!isFileLocalQueryAtom && !isImportedQueryAtom) continue;
          context.report({
            node: candidate.callNode,
            message: `\`${candidate.hookName}(${candidate.atomName})\` subscribes to the whole query atom, so it re-renders your component on every refetch, focus, or no-op cache hit. Derive the field first: \`const dataAtom = atom((get) => get(${candidate.atomName}).data)\`.`,
          });
        }
      },
    };
  },
});
