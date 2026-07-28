import { getNodeLocation } from "../get-node-location.js";
import { areProofLocationsEqual } from "./are-proof-locations-equal.js";
import { getContainingFunction } from "./get-containing-function.js";
import type ts from "typescript";
import type { ReactSemanticCallback, ReactSemanticReachableFunction } from "../types.js";

export interface CollectExecutionCallbackIdsInput {
  callbacks: ReadonlyArray<ReactSemanticCallback>;
  evidenceNode: ts.Node | null;
  ownerId: string;
  reachableFunctions: ReadonlyArray<ReactSemanticReachableFunction>;
  rootDirectory: string;
}

export const collectExecutionCallbackIds = (
  input: CollectExecutionCallbackIdsInput,
): ReadonlyArray<string> => {
  const containingFunction = input.evidenceNode ? getContainingFunction(input.evidenceNode) : null;
  if (!containingFunction) return [];
  const containingLocation = getNodeLocation(containingFunction, input.rootDirectory);
  return [
    ...new Set([
      ...input.callbacks.flatMap((callback) =>
        callback.ownerId === input.ownerId &&
        areProofLocationsEqual(callback.location, containingLocation)
          ? [callback.id]
          : [],
      ),
      ...input.reachableFunctions.flatMap((reachableFunction) =>
        reachableFunction.ownerId === input.ownerId &&
        areProofLocationsEqual(reachableFunction.location, containingLocation)
          ? [reachableFunction.rootCallbackId]
          : [],
      ),
    ]),
  ];
};
