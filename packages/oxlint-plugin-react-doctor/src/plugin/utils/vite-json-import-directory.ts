import * as path from "node:path";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface ViteJsonDirectory {
  readonly path: string;
  readonly extension: ".json";
}

export const getViteJsonImportDirectory = (
  node: EsTreeNode,
  filename: string,
  project: string,
): ViteJsonDirectory | null => {
  if (
    !isNodeOfType(node, "ImportExpression") ||
    node.options ||
    !isNodeOfType(node.source, "TemplateLiteral") ||
    node.source.quasis.length !== 2 ||
    node.source.expressions.length !== 1 ||
    !isNodeOfType(node.source.expressions[0], "Identifier")
  )
    return null;
  const [stem, extension] = node.source.quasis.map((part) => part.value.cooked);
  if (
    typeof stem !== "string" ||
    extension !== ".json" ||
    !/^\.\.?\/(?:[@.A-Za-z0-9_-]+\/)+$/u.test(stem)
  )
    return null;
  const directory = path.resolve(path.dirname(filename), stem);
  const relative = path.relative(project, directory);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    return null;
  // The caller still has to qualify stock dynamic-import-vars and trace
  // the directory's entries and realpath for rebuilds and invalidation.
  return { path: directory, extension: ".json" };
};
