import * as Layer from "effect/Layer";
import { Config, DeadCode, Files, Git, Linter, Project, Reporter, Score } from "@react-doctor/core";
import type { ReactDoctorConfig } from "@react-doctor/core";

export interface BuildRuntimeLayersInput {
  readonly directory: string;
  readonly userConfig: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
  /**
   * Whether lint is disabled (either by user flag or because the
   * oxlint native binding can't load on this Node version). Switches
   * the Linter to `layerOf([])` so the rest of the pipeline still
   * runs.
   */
  readonly shouldSkipLint: boolean;
  readonly shouldRunDeadCode: boolean;
}

/**
 * Composes the production layer stack for `inspect()`'s
 * `Effect.runPromise(Effect.provide(...))` call. Lives outside
 * `inspect.ts` so the orchestrator stays focused on Effect program
 * construction and post-scan rendering — layer wiring is its own
 * concern with its own contract.
 *
 * Same shape as `core/src/run-inspect.ts → layerInspectLive`
 * (the default for `@react-doctor/api → diagnose()`) with two
 * differences specific to the CLI path:
 *
 * - **Config**: the already-resolved scan plan is provided via
 *   `Config.layerOf` instead of re-loading from disk. This keeps
 *   `rootDir`, `configSourceDirectory`, and `config.plugins`
 *   ownership in the shared scan-plan boundary.
 * - **Score**: always `layerOf(null)` because the CLI computes the
 *   real score AFTER `runInspect` returns, with surface filtering
 *   applied (the orchestrator's `Score.compute` only sees the
 *   per-element-filtered list, not the surface-filtered one).
 */
export const buildRuntimeLayers = (input: BuildRuntimeLayersInput) => {
  const linterLayer = input.shouldSkipLint ? Linter.layerOf([]) : Linter.layerOxlint;
  const deadCodeLayer = input.shouldRunDeadCode ? DeadCode.layerNode : DeadCode.layerOf([]);
  // HACK: always provide layerOf(null) for Score — the orchestrator's
  // Score.compute sees the per-element-filtered list, NOT the
  // surface-filtered list this function needs. The CLI computes the
  // real score below with `filterDiagnosticsForSurface("score", ...)`
  // applied first.
  const scoreLayer = Score.layerOf(null);
  const configLayer = Config.layerOf({
    config: input.userConfig,
    resolvedDirectory: input.directory,
    // `configSourceDirectory` is non-null when the config came from
    // disk and `null` only when the caller supplied a programmatic
    // config override. The runner falls back to the scan root there.
    configSourceDirectory: input.configSourceDirectory,
  });

  return Layer.mergeAll(
    Project.layerNode,
    configLayer,
    Files.layerNode,
    Git.layerNode,
    linterLayer,
    deadCodeLayer,
    Reporter.layerNoop,
    scoreLayer,
  );
};
