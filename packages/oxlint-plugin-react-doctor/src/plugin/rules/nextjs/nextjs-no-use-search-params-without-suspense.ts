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
import { findExportedFunctionBody } from "../../utils/find-exported-function-body.js";

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

const exportedComponentUsesSearchParams = (
  absoluteFilePath: string,
  exportedName: string,
): boolean => {
  const programAst = parseSourceFile(absoluteFilePath);
  if (!programAst) return false;
  const functionBody = findExportedFunctionBody(programAst, exportedName);
  if (functionBody) return astContainsUseSearchParams(functionBody);
  return astContainsUseSearchParams(programAst);
};

const isInsideSuspenseBoundary = (node: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isNodeOfType(ancestor.openingElement?.name, "JSXIdentifier") &&
      ancestor.openingElement.name.name === "Suspense"
    ) {
      return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

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
          isNodeOfType(specifier, "ImportSpecifier") &&
          getImportedName(specifier) === "Suspense",
      );
      if (importsSuspense) {
        didDetect = true;
        return false;
      }
    }
  });
  return didDetect;
};

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
      if (isNodeOfType(specifier, "ImportDefaultSpecifier") && specifier.local?.name) {
        entries.set(specifier.local.name, { source, exportedName: "default" });
      } else if (isNodeOfType(specifier, "ImportSpecifier") && specifier.local?.name) {
        entries.set(specifier.local.name, {
          source,
          exportedName: getImportedName(specifier) ?? specifier.local.name,
        });
      }
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

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        const filename = normalizeFilename(context.filename ?? "");
        isPageOrLayoutFile = PAGE_OR_LAYOUT_FILE_PATTERN.test(filename);
        if (!isPageOrLayoutFile) return;
        hasSuspenseInFile = detectSuspenseAwareness(programNode);
        importedComponents = collectRelativeImports(programNode);
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
        if (isInsideSuspenseBoundary(jsxElement)) return;

        const resolvedPath = resolveRelativeImportPath(
          context.filename ?? "",
          importEntry.source,
        );
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
