import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceText } from "./parse-source-file.js";

const property = (node: EsTreeNode): string | null =>
  isNodeOfType(node, "Identifier")
    ? node.name
    : isNodeOfType(node, "Literal") && typeof node.value === "string"
      ? node.value
      : null;

export const confirmsInertModuleReplacement = (
  rootDirectory: string,
  relative: string,
): boolean => {
  try {
    if (!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.cjs$/u.test(relative)) return false;
    const filename = path.join(rootDirectory, relative);
    if (!isPathInside(filename, rootDirectory)) return false;
    recordExistenceProbe(filename);
    recordRealpathProbe(filename);
    if (fs.realpathSync(filename) !== filename) return false;
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.size > 16_384) return false;
    recordContentProbe(filename);
    const ast = parseSourceText({ filename, sourceText: fs.readFileSync(filename, "utf8") });
    if (!isNodeOfType(ast, "Program")) return false;
    const statements = [...ast.body];
    const first = statements[0];
    if (
      isNodeOfType(first, "ExpressionStatement") &&
      isNodeOfType(first.expression, "Literal") &&
      first.expression.value === "use strict"
    ) {
      statements.shift();
    }
    if (statements.length !== 1 || !isNodeOfType(statements[0], "ExpressionStatement"))
      return false;
    const assignment = statements[0].expression;
    if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
      return false;
    const { left, right } = assignment;
    if (
      !isNodeOfType(left, "MemberExpression") ||
      left.computed ||
      left.optional ||
      !isNodeOfType(left.object, "Identifier") ||
      left.object.name !== "module" ||
      property(left.property) !== "exports" ||
      !analyzeScopes(ast).isGlobalReference(left.object) ||
      !isNodeOfType(right, "FunctionExpression") ||
      right.async ||
      right.generator ||
      right.params.length !== 0 ||
      !isNodeOfType(right.body, "BlockStatement") ||
      right.body.body.length !== 1 ||
      !isNodeOfType(right.body.body[0], "ReturnStatement")
    )
      return false;
    const returned = right.body.body[0].argument;
    return isNodeOfType(returned, "Literal") && returned.value === null;
  } catch {
    return false;
  }
};
