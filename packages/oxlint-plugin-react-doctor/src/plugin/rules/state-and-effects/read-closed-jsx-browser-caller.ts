import type { SourceProjectModule } from "../../utils/build-source-project-index.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { StockViteBrowserInspection } from "../../utils/read-verified-stock-vite-browser-project.js";
import { walkAst } from "../../utils/walk-ast.js";

const hasOnlyJsxDefaultImportReferences = (
  unit: SourceProjectModule,
  callerPath: string,
  inspection: StockViteBrowserInspection,
): boolean => {
  const { programNode, scopes } = unit;
  let importCount = 0;
  let unsupported = false;
  walkAst(programNode, (node) => {
    if (unsupported) return false;
    if (inspection.index.resolvedSourcePathByNode.get(node) !== callerPath) return;
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.importKind === "type" ||
      node.specifiers.length !== 1 ||
      !isNodeOfType(node.specifiers[0], "ImportDefaultSpecifier")
    ) {
      unsupported = true;
      return false;
    }
    importCount++;
    const binding = scopes.symbolFor(node.specifiers[0].local);
    if (!binding || !hasCompleteSymbolReferences(binding, programNode, scopes)) {
      unsupported = true;
      return false;
    }
    unsupported = !binding.references.every(({ flag, identifier }) => {
      const tag = identifier.parent;
      return (
        flag === "read" &&
        isNodeOfType(identifier, "JSXIdentifier") &&
        (isNodeOfType(tag, "JSXOpeningElement") || isNodeOfType(tag, "JSXClosingElement")) &&
        tag.name === identifier &&
        Boolean(findEnclosingFunction(tag))
      );
    });
  });
  return !unsupported && importCount === 1;
};

export const readClosedJsxBrowserCaller = (
  callerPath: string,
  inspection: StockViteBrowserInspection,
): readonly string[] | null => {
  const incoming = [...(inspection.index.consumerModulesByFilePath.get(callerPath) ?? [])];
  const browser = incoming.filter(({ filePath }) => inspection.closure.reachable.has(filePath));
  return browser.length > 0 &&
    browser.every((unit) => hasOnlyJsxDefaultImportReferences(unit, callerPath, inspection))
    ? browser.map(({ filePath }) => filePath)
    : null;
};
