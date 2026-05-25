import {
  buildInspectLayers,
  Config,
  DeadCode,
  Linter,
  Score,
} from "@react-doctor/core";
import type { ReactDoctorConfig } from "@react-doctor/core";

export interface BuildRuntimeLayersInput {
  readonly directory: string;
  readonly hasConfigOverride: boolean;
  readonly userConfig: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
  readonly shouldRunScore: boolean;
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
 * - **Config**: when the caller passes `configOverride`, the
 *   already-loaded config is provided via `Config.layerOf` instead
 *   of re-loading from disk; `configSourceDirectory` is threaded
 *   through so `userConfig.plugins` resolution still anchors at
 *   the original config file location.
 * - **Score**: disabled only when the user opted out or lint coverage is
 *   incomplete. The orchestrator applies the `score` surface before
 *   `Score.compute`, so hosts do not need a second score path.
 */
export const buildRuntimeLayers = (input: BuildRuntimeLayersInput) => {
  const linterLayer = input.shouldSkipLint ? Linter.layerOf([]) : Linter.layerOxlint;
  const deadCodeLayer = input.shouldRunDeadCode ? DeadCode.layerNode : DeadCode.layerOf([]);
  const scoreLayer = input.shouldRunScore ? Score.layerHttp : Score.layerOf(null);
  const configLayer = input.hasConfigOverride
    ? Config.layerOf({
        config: input.userConfig,
        resolvedDirectory: input.directory,
        // `configSourceDirectory` is non-null when `inspect()` loaded
        // the config from disk itself (the CLI path) and `null` only
        // when the caller passed `configOverride` programmatically
        // without a corresponding file. The runner falls back to
        // the scan root in the null case.
        configSourceDirectory: input.configSourceDirectory,
      })
    : Config.layerNode;

  return buildInspectLayers({
    config: configLayer,
    linter: linterLayer,
    deadCode: deadCodeLayer,
    score: scoreLayer,
  });
};
