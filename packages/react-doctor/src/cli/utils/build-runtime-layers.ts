import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  Config,
  DeadCode,
  Files,
  Git,
  Linter,
  LintPartialFailures,
  OxlintConcurrency,
  Progress,
  Project,
  Reporter,
  Score,
} from "@react-doctor/core";
import type { ProgressHandle, ProjectInfo, ReactDoctorConfig } from "@react-doctor/core";
import { spinner } from "./spinner.js";

export interface BuildRuntimeLayersInput {
  readonly directory: string;
  readonly hasConfigOverride: boolean;
  readonly userConfig: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
  /**
   * Pre-resolved project metadata for scans that run against a synthetic tree.
   * The baseline diff pass materializes only changed files plus root config, so
   * it must inherit the head scan's project instead of rediscovering.
   */
  readonly projectInfoOverride?: ProjectInfo;
  /**
   * Whether lint is disabled (either by user flag or because the
   * oxlint native binding can't load on this Node version). Switches
   * the Linter to `layerOf([])` so the rest of the pipeline still
   * runs.
   */
  readonly shouldSkipLint: boolean;
  readonly shouldRunDeadCode: boolean;
  /**
   * Whether the run should request a score from the hosted API.
   * `false` swaps `Score.layerHttp` for `Score.layerOf(null)` so the
   * orchestrator's Score service is a no-op for `--no-score` runs.
   */
  readonly shouldComputeScore: boolean;
  /**
   * Whether the lint + dead-code spinners should render on stderr.
   * Set `false` for `--score-only`, `--silent`, or runs that skip
   * lint entirely — the orchestrator's `Progress` lifecycle becomes
   * a noop instead of emitting frames into a quiet stream.
   */
  readonly shouldShowProgressSpinners: boolean;
  /**
   * Resolved oxlint worker count from the CLI's `--no-parallel` flag
   * (today the only value it produces is `1` — serial). When provided, it
   * overrides the `OxlintConcurrency` Reference for this run via
   * `Layer.succeed`; `undefined` leaves the env-seeded ambient default
   * (parallel: auto-detect cores unless `REACT_DOCTOR_PARALLEL` pins a
   * count) in place.
   */
  readonly oxlintConcurrency?: number;
}

/**
 * Adapts the CLI's existing `spinner()` helper (an ora wrapper that
 * already handles non-interactive demotion + `setSpinnerSilent`) into
 * a `ProgressHandle` factory the orchestrator can drive via the
 * `Progress` service.
 */
const buildSpinnerProgressHandle = (text: string): ProgressHandle => {
  const oraHandle = spinner(text).start();
  return {
    update: (displayText: string) => Effect.sync(() => oraHandle.update(displayText)),
    succeed: (displayText: string) => Effect.sync(() => oraHandle.succeed(displayText)),
    fail: (displayText: string) => Effect.sync(() => oraHandle.fail(displayText)),
    stop: () => Effect.sync(() => oraHandle.stop()),
  };
};

/**
 * Composes the production layer stack for `inspect()`'s
 * `Effect.runPromise(Effect.provide(...))` call. Lives outside
 * `inspect.ts` so the orchestrator stays focused on Effect program
 * construction and post-scan rendering — layer wiring is its own
 * concern with its own contract.
 *
 * Same service shape as `@react-doctor/api → diagnose()`'s
 * `buildDiagnoseLayer`, with the differences specific to the CLI path:
 *
 * - **Config**: when the caller passes `configOverride`, the
 *   already-loaded config is provided via `Config.layerOf` instead
 *   of re-loading from disk; `configSourceDirectory` is threaded
 *   through so `userConfig.plugins` resolution still anchors at
 *   the original config file location.
 * - **Score**: `layerHttp` for normal runs; `layerOf(null)` only when
 *   the caller passed `--no-score`. The orchestrator applies the
 *   `"score"` surface filter to the diagnostic set before calling
 *   `Score.compute`, so the in-band score matches what the public-API
 *   contract documents.
 * - **Progress**: `layerOra` wired to the CLI's existing ora-backed
 *   spinner helper for terminal feedback; `layerNoop` for silent /
 *   score-only / lint-skipped runs.
 */
export const buildRuntimeLayers = (input: BuildRuntimeLayersInput) => {
  const linterLayer = input.shouldSkipLint ? Linter.layerOf([]) : Linter.layerOxlint;
  const deadCodeLayer = input.shouldRunDeadCode ? DeadCode.layerNode : DeadCode.layerOf([]);
  const scoreLayer = input.shouldComputeScore ? Score.layerHttp : Score.layerOf(null);
  const projectLayer =
    input.projectInfoOverride === undefined
      ? Project.layerNode
      : Project.layerOf(input.projectInfoOverride);
  const progressLayer = input.shouldShowProgressSpinners
    ? Progress.layerOra(buildSpinnerProgressHandle)
    : Progress.layerNoop;
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

  const baseLayers = Layer.mergeAll(
    projectLayer,
    configLayer,
    Files.layerNode,
    Git.layerNode,
    linterLayer,
    LintPartialFailures.layerLive,
    deadCodeLayer,
    progressLayer,
    Reporter.layerNoop,
    scoreLayer,
  );

  // Only override the ambient `OxlintConcurrency` Reference when the CLI
  // resolved a concrete worker count (today: `--no-parallel` → serial);
  // otherwise leave the env-seeded default (parallel) so
  // `REACT_DOCTOR_PARALLEL` still applies to flag-less runs.
  return input.oxlintConcurrency === undefined
    ? baseLayers
    : Layer.mergeAll(baseLayers, Layer.succeed(OxlintConcurrency, input.oxlintConcurrency));
};
