import ts from "typescript";
import { containsJsx } from "./contains-jsx.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getFunctionName } from "./get-function-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

export const analyzeComponentIdentity = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const violations: ReactProofEvidence[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) {
      const functionName = getFunctionName(node);
      if (functionName && /^[A-Z]/.test(functionName) && containsJsx(node)) {
        violations.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${functionName} is recreated as a component type during render`,
            ["component render", `create component type ${functionName}`, "reconciliation"],
          ),
        );
      }
      return;
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ComponentIdentity,
      ReactObligationStatus.Violated,
      "A component type is created inside another component or hook",
      violations,
    );
  }
  return createObligation(
    ReactProofClaim.ComponentIdentity,
    ReactObligationStatus.Proved,
    "Component type identities are stable across renders",
  );
};
