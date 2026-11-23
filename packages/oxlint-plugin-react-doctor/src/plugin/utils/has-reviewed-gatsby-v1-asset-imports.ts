import * as path from "node:path";
import type { SourceProjectIndex } from "./build-source-project-index.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const STOCK_APP_IMPORTS = new Set([
  "gatsby-link",
  "prop-types",
  "react",
  "react-dom",
  "react-helmet",
  "styled-components",
]);

const OPAQUE_STYLE_GLOBALS = new Set([
  "document",
  "window",
  "self",
  "globalThis",
  "global",
  "require",
  "module",
  "exports",
  "eval",
  "Function",
]);

const STOCK_CONFIG_NAMES = new Set(["gatsby-browser.js", "gatsby-config.js", "gatsby-node.js"]);

const isSupportedBareImport = (specifier: string): boolean =>
  STOCK_APP_IMPORTS.has(specifier) ||
  /^react-icons\/lib\/(?:fa|md)\/[a-z][a-z0-9-]+$/u.test(specifier);

/** Checks runtime module entry requests and direct site-authored stylesheet injection. */
export const hasReviewedGatsbyV1AssetImports = (
  root: string,
  project: SourceProjectIndex,
): boolean => {
  for (const module of project.modulesByFilePath.values()) {
    const relative = path.relative(root, module.filePath);
    // These special entries have separate Gatsby configuration and hook proofs.
    if (STOCK_CONFIG_NAMES.has(relative)) continue;
    let accepted = true;
    walkAst(module.programNode, (node) => {
      if (!accepted) return false;
      if (
        isNodeOfType(node, "ImportDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration") ||
        isNodeOfType(node, "ExportNamedDeclaration")
      ) {
        if ("importKind" in node && node.importKind === "type") return;
        if ("exportKind" in node && node.exportKind === "type") return;
        const specifier = node.source?.value;
        if (typeof specifier !== "string") return;
        if (/^\.\.?\//u.test(specifier)) {
          const resolved = project.resolvedSourcePathByNode.get(node);
          accepted =
            (resolved !== undefined && project.modulesByFilePath.has(resolved)) ||
            /\.(?:css|png)$/u.test(specifier);
        } else {
          accepted =
            isSupportedBareImport(specifier) &&
            (!isNodeOfType(node, "ImportDeclaration") || node.specifiers.length > 0);
        }
      } else if (
        isNodeOfType(node, "ImportExpression") ||
        (isNodeOfType(node, "Identifier") &&
          OPAQUE_STYLE_GLOBALS.has(node.name) &&
          module.scopes.isGlobalReference(node)) ||
        (isNodeOfType(node, "JSXOpeningElement") &&
          isNodeOfType(node.name, "JSXIdentifier") &&
          (node.name.name === "style" || node.name.name === "link"))
      )
        accepted = false;
      return accepted;
    });
    if (!accepted) return false;
  }
  return true;
};
