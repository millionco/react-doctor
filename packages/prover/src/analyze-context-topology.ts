import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofLocation,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

const createGraphEvidence = (
  location: ReactProofLocation,
  description: string,
  trace: ReadonlyArray<string>,
): ReactProofEvidence => ({ description, location, trace });

export const analyzeContextTopology = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const semanticUnit = findSemanticUnit(unit, context);
  if (!context.graph || !semanticUnit) {
    return createObligation(
      ReactProofClaim.ContextTopology,
      ReactObligationStatus.Unknown,
      "The semantic graph could not identify this context owner",
      [],
    );
  }

  const providers = context.graph.contextProviders.filter(
    (provider) => provider.ownerId === semanticUnit.id,
  );
  const consumers = context.graph.contextConsumers.filter(
    (consumer) => consumer.ownerId === semanticUnit.id,
  );
  const providersById = new Map(
    context.graph.contextProviders.map((provider) => [provider.id, provider]),
  );
  const missingValueProviders = providers.filter((provider) => !provider.valueProvided);
  const consumersWithMissingValueSources = consumers.filter((consumer) =>
    consumer.sourceProviderIds.some((providerId) => !providersById.get(providerId)?.valueProvided),
  );
  if (missingValueProviders.length > 0 || consumersWithMissingValueSources.length > 0) {
    const evidence = [
      ...missingValueProviders.map((provider) =>
        createGraphEvidence(
          provider.location,
          "A context provider does not supply its required value",
          [
            "context provider",
            "missing value prop",
            "consumers receive undefined instead of the declared value",
          ],
        ),
      ),
      ...consumersWithMissingValueSources.map((consumer) =>
        createGraphEvidence(
          consumer.location,
          "A context consumer can resolve to a provider without a value",
          [consumer.hookName, "nearest matching provider", "missing provider value"],
        ),
      ),
    ];
    return createObligation(
      ReactProofClaim.ContextTopology,
      ReactObligationStatus.Violated,
      "A context provider-consumer path has no valid value",
      evidence,
    );
  }

  const unresolvedConsumers = consumers.filter(
    (consumer) => !consumer.contextId || !consumer.topologyComplete,
  );
  if (unresolvedConsumers.length > 0) {
    return createObligation(
      ReactProofClaim.ContextTopology,
      ReactObligationStatus.Unknown,
      "A context consumer has unresolved provider topology",
      unresolvedConsumers.map((consumer) =>
        createGraphEvidence(
          consumer.location,
          consumer.contextId
            ? "No closed render path reaches this context consumer"
            : "The context object could not be resolved to a project definition",
          [
            consumer.hookName,
            "exact context object identity",
            "nearest-provider proof is incomplete",
          ],
        ),
      ),
    );
  }

  return createObligation(
    ReactProofClaim.ContextTopology,
    ReactObligationStatus.Proved,
    consumers.length > 0
      ? "Every context read resolves through exact object identity and closed render paths"
      : "Every context provider is well-formed",
    [],
  );
};
