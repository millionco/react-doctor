import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { PAGE_OR_LAYOUT_FILE_PATTERN } from "../../constants/nextjs.js";
import { resolveImportedExportName } from "../../utils/find-exported-function-body.js";
import { resolveCrossFileFunctionExport } from "../../utils/resolve-cross-file-function-export.js";
import { astMentionsSuspense } from "../../utils/ast-mentions-suspense.js";
import { hasAncestorSuspenseLayout } from "../../utils/find-ancestor-suspense-layout.js";

interface ImportedComponentEntry {
  readonly source: string;
  readonly exportedName: string;
}

const astContainsUseSearchParams = (root: EsTreeNode): boolean => {
  let didFind = false;
  walkAst(root, (child: EsTreeNode) => {
    if (didFind) return false;
    if (isHookCall(child, "useSearchParams")) {
      didFind = true;
      return false;
    }
  });
  return didFind;
};

// Recognises `<Suspense>`, an aliased `import { Suspense as X }` (local
// names gathered by `collectSuspenseLocalNames`), and the member form
// `<React.Suspense>` (matched structurally on the `.Suspense` member).
// Without these a page that DID wrap the consumer via `React.Suspense`
// or an alias would be falsely flagged.
const isSuspenseJsxName = (
  name: EsTreeNode | null | undefined,
  suspenseLocalNames: ReadonlySet<string>,
): boolean => {
  if (isNodeOfType(name, "JSXIdentifier")) {
    return name.name === "Suspense" || suspenseLocalNames.has(name.name);
  }
  return (
    isNodeOfType(name, "JSXMemberExpression") &&
    isNodeOfType(name.property, "JSXIdentifier") &&
    name.property.name === "Suspense"
  );
};

const isInsideSuspenseBoundary = (
  node: EsTreeNode,
  suspenseLocalNames: ReadonlySet<string>,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isSuspenseJsxName(ancestor.openingElement?.name, suspenseLocalNames)
    ) {
      return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// Local identifiers bound to React's `Suspense` (`import { Suspense }`
// or `import { Suspense as Boundary }`), consumed by the per-element
// boundary check. The member form (`<React.Suspense>`) is matched
// structurally and needs no entry here.
const collectSuspenseLocalNames = (programNode: EsTreeNodeOfType<"Program">): Set<string> => {
  const names = new Set<string>();
  for (const statement of programNode.body ?? []) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    if (statement.source?.value !== "react") continue;
    for (const specifier of statement.specifiers ?? []) {
      if (
        isNodeOfType(specifier, "ImportSpecifier") &&
        getImportedName(specifier) === "Suspense" &&
        specifier.local?.name
      ) {
        names.add(specifier.local.name);
      }
    }
  }
  return names;
};

// Maps the local JSX name of each imported component to its module
// source + exported name. Relative AND tsconfig-alias (`@/…`) imports
// are kept; resolution (relative → alias → barrel/re-export) happens at
// the render site via `resolveCrossFileFunctionExport`, which returns
// null for bare node-module specifiers so they're skipped.
const collectImportedComponents = (
  programNode: EsTreeNodeOfType<"Program">,
): Map<string, ImportedComponentEntry> => {
  const entries = new Map<string, ImportedComponentEntry>();
  for (const statement of programNode.body ?? []) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    if (typeof statement.source?.value !== "string") continue;
    const source = statement.source.value;
    for (const specifier of statement.specifiers ?? []) {
      const localName = specifier.local?.name;
      if (!localName) continue;
      const exportedName = resolveImportedExportName(specifier);
      if (!exportedName) continue;
      entries.set(localName, { source, exportedName });
    }
  }
  return entries;
};

export const nextjsNoUseSearchParamsWithoutSuspense = defineRule<Rule>({
  id: "nextjs-no-use-search-params-without-suspense",
  title: "useSearchParams without Suspense",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Wrap the component using `useSearchParams` in `<Suspense>` so the rest of the page can stay statically rendered.",
  create: (context: RuleContext) => {
    let isPageOrLayoutFile = false;
    // A <Suspense> in an ancestor `layout.tsx` wraps `{children}`, so it
    // covers the ENTIRE page — both direct calls and rendered consumers.
    let hasAncestorLayoutSuspense = false;
    // A <Suspense> in THIS file only covers the direct same-file call
    // (the cross-file path uses precise per-element ancestry instead, so
    // a consumer rendered outside an in-file boundary is still caught).
    let hasSuspenseInFile = false;
    let importedComponents = new Map<string, ImportedComponentEntry>();
    let suspenseLocalNames: ReadonlySet<string> = new Set();

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        const filename = normalizeFilename(context.filename ?? "");
        isPageOrLayoutFile = PAGE_OR_LAYOUT_FILE_PATTERN.test(filename);
        if (!isPageOrLayoutFile) return;
        hasAncestorLayoutSuspense = hasAncestorSuspenseLayout(context.filename ?? "");
        if (hasAncestorLayoutSuspense) return;
        hasSuspenseInFile = astMentionsSuspense(programNode);
        importedComponents = collectImportedComponents(programNode);
        suspenseLocalNames = collectSuspenseLocalNames(programNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isPageOrLayoutFile || hasAncestorLayoutSuspense || hasSuspenseInFile) return;
        if (!isHookCall(node, "useSearchParams")) return;
        context.report({
          node,
          message:
            "useSearchParams() without a <Suspense> boundary forces the whole page into client-side rendering.",
        });
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isPageOrLayoutFile || hasAncestorLayoutSuspense) return;
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const importEntry = importedComponents.get(node.name.name);
        if (!importEntry) return;

        const jsxElement = node.parent;
        if (!jsxElement) return;
        if (isInsideSuspenseBoundary(jsxElement, suspenseLocalNames)) return;

        // Resolve to the imported component's own function body (relative,
        // tsconfig alias, or barrel re-export). The resolver returns null
        // when the export doesn't bind to a function — we never fall back
        // to scanning the whole module, which would flag this component
        // for an unrelated sibling export's useSearchParams() call.
        const componentBody = resolveCrossFileFunctionExport(
          context.filename ?? "",
          importEntry.source,
          importEntry.exportedName,
        );
        if (!componentBody || !astContainsUseSearchParams(componentBody)) return;

        context.report({
          node,
          message: `<${node.name.name}> uses useSearchParams() outside <Suspense>, so this page falls back to client-side rendering.`,
        });
      },
    };
  },
});
