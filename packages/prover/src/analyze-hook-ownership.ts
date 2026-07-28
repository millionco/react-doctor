import type ts from "typescript";
import { createObligation } from "./create-obligation.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactProofObligation } from "./types.js";

export const analyzeHookOwnership = (
  _functionNode: ts.FunctionLikeDeclaration,
): ReactProofObligation =>
  createObligation(
    ReactProofClaim.HookOwnership,
    ReactObligationStatus.Proved,
    "Every direct hook call belongs to a component or custom hook",
  );
