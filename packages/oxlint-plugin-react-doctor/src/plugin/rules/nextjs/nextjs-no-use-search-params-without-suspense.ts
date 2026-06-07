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
import { parseSourceFile } from "../../utils/parse-source-file.js";
import { resolveRelativeImportPath } from "../../utils/resolve-relative-import-path.js";
import {
  findExportedFunctionBody,
  resolveImportedExportName,
} from "../../utils/find-exported-function-body.js";

const RELATIVE_IMPORT_PREFIX = /^\.\.?\//;

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

// Resolves the imported component's own function body and checks ONLY
// that body for `useSearchParams()`. When the export doesn't bind to a
// function in this file — `memo()` / `forwardRef()` wrappers, class
// components, or a barrel re-export (`export { X } from "./y"`, which
// `findExportedFunctionBody` deliberately does not follow) — we bail
// rather than scan the whole module: a whole-file scan would flag this
// component for an UNRELATED sibling export's `useSearchParams()` call
// (false positive), and this rule prefers a false negative.
const exportedComponentUsesSearchParams = (
  absoluteFilePath: string,
  exportedName: string,
): boolean => {
  const programAst = parseSourceFile(absoluteFilePath);
  if (!programAst) return false;
  const functionBody = findExportedFunctionBody(programAst, exportedName);
  if (!functionBody) return false;
  return astContainsUseSearchParams(functionBody);
};

// Recognises `<Suspense>`, an aliased `import { Suspense as X }` (local
// names gathered by `collectSuspenseLocalNames`), and the member form
// `<React.Suspense>` (matched structurally on the `.Suspense` member).
// Without these a page that DID wrap the consumer via `React.Suspense`
// or an alias would be falsely flagged — the #695 class of bug.
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

// HACK: file-level proxy for "is the developer aware of the Suspense
// requirement?", used ONLY for the same-file direct `useSearchParams()`
// call. Per-call ancestor analysis isn't tractable for a bare hook
// call; the official `@next/next/no-use-search-params-without-suspense-
// bailout` rule uses the same heuristic. If <Suspense> appears anywhere
// in the file (as a JSX element OR a named import from React) we trust
// the developer renders the consumer behind it.
//
// KNOWN LIMITATION (false negative): a file that imports `Suspense`
// from React for an unrelated reason silences the same-file report. We
// accept it because a false POSITIVE is much louder than a false
// negative. The cross-file path below does precise per-element
// ancestry (`isInsideSuspenseBoundary`) instead of this heuristic.
const detectSuspenseAwareness = (programNode: EsTreeNode): boolean => {
  let didDetect = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didDetect) return false;
    if (
      isNodeOfType(child, "JSXOpeningElement") &&
      isNodeOfType(child.name, "JSXIdentifier") &&
      child.name.name === "Suspense"
    ) {
      didDetect = true;
      return false;
    }
    if (isNodeOfType(child, "ImportDeclaration") && child.source?.value === "react") {
      const importsSuspense = (child.specifiers ?? []).some(
        (specifier: EsTreeNode) =>
          isNodeOfType(specifier, "ImportSpecifier") && getImportedName(specifier) === "Suspense",
      );
      if (importsSuspense) {
        didDetect = true;
        return false;
      }
    }
  });
  return didDetect;
};

// Local identifiers bound to React's `Suspense` (`import { Suspense }`
// or `import { Suspense as Boundary }`), consumed by the cross-file
// per-element boundary check. The member form (`<React.Suspense>`) is
// matched structurally and needs no entry here.
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

// Maps the local JSX name of each RELATIVELY imported component to its
// module source + exported name, for the cross-file boundary check.
//
// KNOWN LIMITATION (false negative): only relative (`./`, `../`)
// imports are followed — tsconfig `paths` / `@/…` aliases are not
// resolved, so alias-imported consumers go unchecked. As with the
// Suspense heuristic above, we prefer a false negative over the noise a
// misresolution would create.
const collectRelativeImports = (
  programNode: EsTreeNodeOfType<"Program">,
): Map<string, ImportedComponentEntry> => {
  const entries = new Map<string, ImportedComponentEntry>();
  for (const statement of programNode.body ?? []) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    const source = statement.source?.value;
    if (typeof source !== "string") continue;
    if (!RELATIVE_IMPORT_PREFIX.test(source)) continue;
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
    "Wrap the component using useSearchParams: `<Suspense fallback={<Skeleton />}><SearchComponent /></Suspense>`",
  create: (context: RuleContext) => {
    let hasSuspenseInFile = false;
    let isPageOrLayoutFile = false;
    let importedComponents = new Map<string, ImportedComponentEntry>();
    let suspenseLocalNames: ReadonlySet<string> = new Set();

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        const filename = normalizeFilename(context.filename ?? "");
        isPageOrLayoutFile = PAGE_OR_LAYOUT_FILE_PATTERN.test(filename);
        if (!isPageOrLayoutFile) return;
        hasSuspenseInFile = detectSuspenseAwareness(programNode);
        importedComponents = collectRelativeImports(programNode);
        suspenseLocalNames = collectSuspenseLocalNames(programNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isPageOrLayoutFile) return;
        if (hasSuspenseInFile) return;
        if (!isHookCall(node, "useSearchParams")) return;
        context.report({
          node,
          message:
            "useSearchParams() without a <Suspense> boundary forces the whole page into client-side rendering.",
        });
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isPageOrLayoutFile) return;
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const componentName = node.name.name;
        const importEntry = importedComponents.get(componentName);
        if (!importEntry) return;

        const jsxElement = node.parent;
        if (!jsxElement) return;
        if (isInsideSuspenseBoundary(jsxElement, suspenseLocalNames)) return;

        const resolvedPath = resolveRelativeImportPath(context.filename ?? "", importEntry.source);
        if (!resolvedPath) return;
        if (!exportedComponentUsesSearchParams(resolvedPath, importEntry.exportedName)) return;

        context.report({
          node,
          message: `<${componentName}> uses useSearchParams() but is not wrapped in a <Suspense> boundary.`,
        });
      },
    };
  },
});
