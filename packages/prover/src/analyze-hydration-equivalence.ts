import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactHydrationRootKind,
  ReactHydrationStatus,
  ReactObligationStatus,
  ReactProofClaim,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeHydrationEquivalence = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  const hydration = semanticUnit
    ? context.graph?.hydrations.find((candidate) => candidate.ownerId === semanticUnit.id)
    : null;
  if (!context.graph || !semanticUnit || !hydration) {
    return createObligation(
      ReactProofClaim.HydrationEquivalence,
      ReactObligationStatus.Unknown,
      "The semantic graph could not establish hydration reachability",
    );
  }
  const rootsById = new Map(context.graph.hydrationRoots.map((root) => [root.id, root]));
  const hazardsById = new Map(context.graph.hydrationHazards.map((hazard) => [hazard.id, hazard]));
  if (hydration.status === ReactHydrationStatus.Mismatched) {
    const evidence: ReactProofEvidence[] = hydration.hazardIds.flatMap((hazardId) => {
      const hazard = hazardsById.get(hazardId);
      return hazard
        ? [
            {
              description: hazard.description,
              location: hazard.location,
              trace: ["server render", "first client render", "non-equivalent hydration output"],
            },
          ]
        : [];
    });
    if (evidence.length === 0) {
      const sourceRootIds = [
        ...hydration.staticServerRootIds,
        ...hydration.clientRootIds,
        ...hydration.interactiveServerRootIds,
      ];
      for (const rootId of sourceRootIds) {
        const root = rootsById.get(rootId);
        if (!root) continue;
        evidence.push({
          description:
            root.kind === ReactHydrationRootKind.ServerStatic
              ? `${root.apiName} produces markup that React cannot hydrate`
              : `${root.apiName} has a different hydration root contract`,
          location: root.location,
          trace: ["server root", "client hydration root", "incompatible root contract"],
        });
      }
    }
    return createObligation(
      ReactProofClaim.HydrationEquivalence,
      ReactObligationStatus.Violated,
      "The first client render is not equivalent to the server-rendered tree",
      evidence,
    );
  }
  if (hydration.status === ReactHydrationStatus.Unknown) {
    const evidence = context.graph.hydrationRoots
      .filter((root) => !root.sourceComplete)
      .map((root) => ({
        description: `${root.apiName} has an unresolved execution root, component, or identifier prefix`,
        location: root.location,
        trace: ["React root", "opaque hydration contract", "unproved first render"],
      }));
    return createObligation(
      ReactProofClaim.HydrationEquivalence,
      ReactObligationStatus.Unknown,
      "The server and client hydration roots cannot be paired completely",
      evidence,
    );
  }
  return createObligation(
    ReactProofClaim.HydrationEquivalence,
    ReactObligationStatus.Proved,
    hydration.status === ReactHydrationStatus.NotHydrated
      ? "The unit is outside every source-visible hydration root"
      : "The server and first client render have the same modeled environment contract",
  );
};
