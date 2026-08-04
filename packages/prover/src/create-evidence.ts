import type ts from "typescript";
import { getNodeLocation } from "./get-node-location.js";
import type { ReactProofEvidence } from "./types.js";

export const createEvidence = (
  node: ts.Node,
  rootDirectory: string,
  description: string,
  trace: ReadonlyArray<string> = [],
): ReactProofEvidence => ({
  description,
  location: getNodeLocation(node, rootDirectory),
  trace,
});
