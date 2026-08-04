import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactLazyDeclarationStatus,
  ReactLazyLoaderStatus,
  ReactObligationStatus,
  ReactProofClaim,
  ReactSuspenseCoverageStatus,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

export const analyzeLazySuspense = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!context.graph || !semanticUnit) {
    return createObligation(
      ReactProofClaim.LazySuspense,
      ReactObligationStatus.Unknown,
      "The semantic graph could not identify lazy component topology",
    );
  }
  const lazyRenders = context.graph.lazyRenders.filter(
    (render) => render.ownerId === semanticUnit.id,
  );
  const renderedComponentIds = new Set(lazyRenders.map((render) => render.lazyComponentId));
  const lazyComponents = context.graph.lazyComponents.filter(
    (component) =>
      component.declarationOwnerId === semanticUnit.id ||
      renderedComponentIds.has(component.id) ||
      (!component.identityResolved &&
        !component.declarationOwnerId &&
        semanticUnit.canBeRenderRoot),
  );
  const violatedEvidence: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  for (const component of lazyComponents) {
    if (!component.identityResolved) {
      unknownEvidence.push({
        description: `${component.name} has no stable symbol identity`,
        location: component.location,
        trace: ["lazy component", "unsupported declaration shape", "unresolved JSX renders"],
      });
    }
    if (component.declarationStatus === ReactLazyDeclarationStatus.RenderUnstable) {
      violatedEvidence.push({
        description: `${component.name} is redeclared during React execution`,
        location: component.location,
        trace: ["lazy component", "unstable declaration identity", "state reset"],
      });
    }
    if (component.loaderStatus === ReactLazyLoaderStatus.Invalid) {
      violatedEvidence.push({
        description: `${component.name} does not have a total thenable loader with a callable default export`,
        location: component.location,
        trace: ["lazy loader", "invalid resolved module", "unsupported component render"],
      });
    } else if (component.loaderStatus === ReactLazyLoaderStatus.Opaque) {
      unknownEvidence.push({
        description: `${component.name} crosses an unresolved lazy loader boundary`,
        location: component.location,
        trace: ["lazy loader", "opaque return flow", "unproved component module"],
      });
    }
  }
  for (const render of lazyRenders) {
    if (render.coverageStatus === ReactSuspenseCoverageStatus.OutsideBoundary) {
      violatedEvidence.push({
        description: "A reachable lazy component render can suspend outside Suspense",
        location: render.location,
        trace: ["lazy component render", "root-reachable unbounded path", "missing fallback"],
      });
    } else if (render.coverageStatus === ReactSuspenseCoverageStatus.Unknown) {
      unknownEvidence.push({
        description: "A lazy component render crosses unresolved Suspense topology",
        location: render.location,
        trace: ["lazy component render", "opaque render or ReactNode slot", "unknown fallback"],
      });
    }
  }
  if (violatedEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.LazySuspense,
      ReactObligationStatus.Violated,
      "A lazy component violates declaration, loader, or Suspense coverage requirements",
      violatedEvidence,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.LazySuspense,
      ReactObligationStatus.Unknown,
      "A lazy component protocol crosses an opaque proof boundary",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.LazySuspense,
    ReactObligationStatus.Proved,
    lazyRenders.length > 0
      ? "Every lazy component has stable loader identity and complete Suspense coverage"
      : "The unit renders no lazy component",
  );
};
