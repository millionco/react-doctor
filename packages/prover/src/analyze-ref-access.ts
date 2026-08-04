import ts from "typescript";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

export const analyzeRefAccess = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const violations: ReactProofEvidence[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) {
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "current" &&
      ts.isIdentifier(node.expression)
    ) {
      const refSymbol = context.typeChecker.getSymbolAtLocation(node.expression);
      if (refSymbol && hookBindings.refs.has(refSymbol)) {
        violations.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${node.expression.text}.current is accessed during render`,
            ["render", `${node.expression.text}.current`, "phase-sensitive ref access"],
          ),
        );
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.RefAccess,
      ReactObligationStatus.Violated,
      "A component reads or writes a ref during render",
      violations,
    );
  }
  return createObligation(
    ReactProofClaim.RefAccess,
    ReactObligationStatus.Proved,
    "Ref access is confined to non-render phases",
  );
};
