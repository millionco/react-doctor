import type { ReactProofEvidence, ReactProofObligation } from "./types.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";

export const createObligation = (
  claim: ReactProofClaim,
  status: ReactObligationStatus,
  summary: string,
  evidence: ReadonlyArray<ReactProofEvidence> = [],
): ReactProofObligation => ({
  claim,
  status,
  summary,
  evidence,
});
