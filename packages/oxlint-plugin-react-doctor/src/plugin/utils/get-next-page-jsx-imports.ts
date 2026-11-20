import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { parseSourceFile } from "./parse-source-file.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { resolveUniqueRelativeFileImportPath } from "./resolve-relative-import-path.js";

const emptyNames: ReadonlySet<string> = new Set();

export const getNextPageJsxImports = (filename: string): ReadonlySet<string> => {
  if (!path.isAbsolute(filename) || path.extname(filename) !== ".tsx") return emptyNames;
  const ownPath = path.resolve(filename);
  const packageDirectory = findNearestPackageDirectory(ownPath);
  if (!packageDirectory) return emptyNames;
  const relativePath = path.relative(packageDirectory, ownPath);
  const segments = relativePath.split(path.sep);
  const isAppRouterPath = segments[0] === "app" || (segments[0] === "src" && segments[1] === "app");
  if (!isAppRouterPath || segments.slice(0, -1).some((segment) => segment.startsWith("_"))) {
    return emptyNames;
  }

  const pagePath = path.join(path.dirname(ownPath), "page.tsx");
  if (pagePath === ownPath) return emptyNames;
  const page = parseSourceFile(pagePath);
  if (
    !isNodeOfType(page, "Program") ||
    !page.body.some((statement) => isNodeOfType(statement, "ExportDefaultDeclaration"))
  ) {
    return emptyNames;
  }

  const moduleName = "./" + path.basename(ownPath, ".tsx");
  const exactModuleName = moduleName + ".tsx";
  const componentNames = new Set<string>();
  let scopes: ReturnType<typeof analyzeScopes> | undefined;
  for (const statement of page.body) {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      isTypeOnlyImport(statement) ||
      (statement.source.value !== moduleName && statement.source.value !== exactModuleName) ||
      resolveUniqueRelativeFileImportPath(pagePath, statement.source.value) !== ownPath
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type") continue;
      const importedName = getImportedName(specifier);
      const symbol = (scopes ??= analyzeScopes(page)).symbolFor(specifier.local);
      if (!importedName || !symbol) continue;
      let hasOpeningElement = false;
      const areJsxReferences = symbol.references.every((reference) => {
        const name = reference.identifier;
        const parent = name.parent;
        if (reference.flag !== "read" || !isNodeOfType(name, "JSXIdentifier")) return false;
        if (isNodeOfType(parent, "JSXOpeningElement") && parent.name === name) {
          hasOpeningElement = true;
          return true;
        }
        return isNodeOfType(parent, "JSXClosingElement") && parent.name === name;
      });
      if (hasOpeningElement && areJsxReferences) componentNames.add(importedName);
    }
  }
  return componentNames;
};
