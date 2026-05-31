import { defineRule } from "../../utils/define-rule.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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

// Bindings imported from another file follow a strong naming convention
// in jotai-tanstack-query codebases (the library's own README + every
// real OSS example uses this shape). When we see an imported binding
// with one of these suffixes used with `useAtomValue` / `useAtom`,
// treat it as a query atom even though we can't see the source-of-
// truth `atomWithQuery(...)` call. False-positive risk is low: a
// non-tq atom that happens to be named `*QueryAtom` is an unusual
// naming clash. False-negative risk for the file-local case is zero
// (those still resolve via the binding tracker below).
const QUERY_ATOM_NAMING_CONVENTION =
  /(SuspenseInfiniteQuery|SuspenseQuery|InfiniteQuery|Query)Atom$/;

export const jotaiTqUseRawQueryAtom = defineRule<Rule>({
  id: "jotai-tq-use-raw-query-atom",
  title: "Subscribing to raw query atom",
  severity: "warn",
  recommendation:
    "Derive the field you read: `const dataAtom = atom((get) => get(queryAtom).data)`. Subscribing to the whole query atom re-renders on every refetch, focus, or no-op cache hit.",
  create: (context: RuleContext) => {
    const queryAtomFactoryLocalNames = new Set<string>();
    const queryAtomBindingNames = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;
        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          if (!isNodeOfType(specifier.local, "Identifier")) continue;
          const localName = specifier.local.name;
          if (source === "jotai-tanstack-query") {
            const importedName = getImportedName(specifier);
            if (importedName && QUERY_ATOM_FACTORY_IMPORTED_NAMES.has(importedName)) {
              queryAtomFactoryLocalNames.add(localName);
            }
            continue;
          }
          // Cross-file: trust the naming convention for bindings imported
          // from another file. Library imports (`jotai`, `react`, etc.)
          // wouldn't normally have a `*QueryAtom`-shaped binding name,
          // but skip them to be safe.
          if (typeof source !== "string") continue;
          if (source.startsWith("jotai") || source === "react" || source.startsWith("react/")) {
            continue;
          }
          if (QUERY_ATOM_NAMING_CONVENTION.test(localName)) {
            queryAtomBindingNames.add(localName);
          }
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (queryAtomFactoryLocalNames.size === 0) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        const initializer: EsTreeNode | null | undefined = node.init;
        if (!isNodeOfType(initializer, "CallExpression")) return;
        if (!isNodeOfType(initializer.callee, "Identifier")) return;
        if (!queryAtomFactoryLocalNames.has(initializer.callee.name)) return;
        queryAtomBindingNames.add(node.id.name);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (queryAtomBindingNames.size === 0) return;
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (!SUBSCRIBING_HOOK_NAMES.has(node.callee.name)) return;
        const args = node.arguments ?? [];
        if (args.length === 0) return;
        const firstArgument = args[0];
        if (!isNodeOfType(firstArgument, "Identifier")) return;
        if (!queryAtomBindingNames.has(firstArgument.name)) return;
        context.report({
          node,
          message: `\`${node.callee.name}(${firstArgument.name})\` subscribes to the whole query atom, so it re-renders your component on every refetch, focus, or no-op cache hit. Derive the field first: \`const dataAtom = atom((get) => get(${firstArgument.name}).data)\`.`,
        });
      },
    };
  },
});
