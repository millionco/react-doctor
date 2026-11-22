import type { OxlintWorkerProbeResult, OxlintWorkerProbeTrace } from "../../start-oxlint-worker.js";
import type { SidecarDependencyProbe } from "./sidecar-lint-cache.js";

export const internWorkerSidecarProbeIds = (
  result: OxlintWorkerProbeResult,
  trace: OxlintWorkerProbeTrace,
  internRelativeProbe: (
    kind: SidecarDependencyProbe["kind"],
    relativePath: string,
    knownAnswer: string | null,
  ) => number,
): number[] => {
  const probeIds: number[] = [];
  // The worker answers path existence. The parent supplies content hashes.
  for (const pathIndex of trace.content) {
    probeIds.push(internRelativeProbe("content", result.paths[pathIndex], null));
  }
  for (const pathIndex of trace.existence) {
    probeIds.push(
      internRelativeProbe("exists", result.paths[pathIndex], result.existenceAnswers[pathIndex]),
    );
  }
  return probeIds;
};
