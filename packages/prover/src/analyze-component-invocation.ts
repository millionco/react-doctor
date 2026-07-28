import ts from "typescript";
import { containsJsx } from "./contains-jsx.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCallName } from "./get-call-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

export const analyzeComponentInvocation = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const violations: ReactProofEvidence[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const callName = getCallName(node)?.split(".").at(-1);
      const callSymbol = context.typeChecker.getSymbolAtLocation(node.expression);
      const resolvedSymbol =
        callSymbol && (callSymbol.flags & ts.SymbolFlags.Alias) !== 0
          ? context.typeChecker.getAliasedSymbol(callSymbol)
          : callSymbol;
      const isComponentCall = Boolean(
        callName &&
        /^[A-Z]/.test(callName) &&
        resolvedSymbol?.declarations?.some((declaration) => {
          if (isFunctionBoundary(declaration)) {
            return containsJsx(declaration);
          }
          if (
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer &&
            (ts.isFunctionExpression(declaration.initializer) ||
              ts.isArrowFunction(declaration.initializer))
          ) {
            return containsJsx(declaration.initializer);
          }
          return false;
        }),
      );
      if (callName && isComponentCall) {
        violations.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${callName} is called as a regular function instead of rendered by React`,
            ["render", `call ${callName}`, "hook and component ownership bypassed"],
          ),
        );
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ComponentInvocation,
      ReactObligationStatus.Violated,
      "A component is invoked outside React reconciliation",
      violations,
    );
  }
  return createObligation(
    ReactProofClaim.ComponentInvocation,
    ReactObligationStatus.Proved,
    "No component function is invoked directly",
  );
};
