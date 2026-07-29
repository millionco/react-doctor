import type ts from "typescript";
import { getNodeLocation } from "../get-node-location.js";
import type { ReactAnalysisContext } from "../types.js";

export const createSemanticId = (
  kind: string,
  name: string,
  node: ts.Node,
  context: ReactAnalysisContext,
): string => {
  const location = getNodeLocation(node, context.rootDirectory);
  return `${location.filePath}:${location.line}:${location.column}:${kind}:${name}`;
};
