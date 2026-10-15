import * as fs from "node:fs";
import * as path from "node:path";
import { NEXT_CONFIG_FILENAMES, PAGES_COMPONENT_FILE_PATTERN } from "../constants/nextjs.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { declaresDependency } from "./classify-package-platform.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findExportedValue } from "./find-exported-value.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface NextPagesDefaultComponentInput {
  program: EsTreeNode;
  filename: string | undefined;
  getScopes: () => ScopeAnalysis;
}

export const findNextPagesDefaultComponent = ({
  program,
  filename,
  getScopes,
}: NextPagesDefaultComponentInput): EsTreeNode | null => {
  if (!filename || !normalizeFilename(filename).split("/").includes("pages")) return null;
  const exportedFunction = findExportedValue(program, "default");
  if (!isFunctionLike(exportedFunction)) return null;
  if (!isNodeOfType(exportedFunction, "ArrowFunctionExpression") && exportedFunction.generator)
    return null;
  const returnedExpressions = isNodeOfType(exportedFunction.body, "BlockStatement")
    ? collectFunctionReturnStatements(exportedFunction).flatMap((statement) =>
        statement.argument ? [statement.argument] : [],
      )
    : [exportedFunction.body];
  if (
    !returnedExpressions.some((expression) => {
      const returnedValue = stripParenExpression(expression);
      return (
        isNodeOfType(returnedValue, "JSXElement") || isNodeOfType(returnedValue, "JSXFragment")
      );
    })
  )
    return null;
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return null;
  const relativeFilename = normalizeFilename(path.relative(packageDirectory, filename));
  if (!PAGES_COMPONENT_FILE_PATTERN.test(relativeFilename)) return null;
  const manifest = readPackageManifest(packageDirectory);
  if (!manifest || !declaresDependency(manifest, "next")) return null;
  // Custom pageExtensions can turn files under pages into ordinary helpers.
  for (const configFilename of NEXT_CONFIG_FILENAMES) {
    const configPath = path.join(packageDirectory, configFilename);
    recordExistenceProbe(configPath);
    if (fs.existsSync(configPath)) return null;
  }
  if (relativeFilename.startsWith("src/")) {
    const rootPagesPath = path.join(packageDirectory, "pages");
    recordExistenceProbe(rootPagesPath);
    if (fs.existsSync(rootPagesPath)) return null;
  }
  if (
    getScopes().rootScope.symbols.some(
      (symbol) =>
        symbol.initializer &&
        stripParenExpression(symbol.initializer) === exportedFunction &&
        symbol.references.some((reference) => reference.flag !== "read"),
    )
  )
    return null;
  return exportedFunction;
};
