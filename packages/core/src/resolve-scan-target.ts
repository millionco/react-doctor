import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfigWithSource } from "./load-config.js";
import { isDirectory, NotADirectoryError, ProjectNotFoundError } from "./project-info/index.js";
import { resolveConfigRootDir } from "./resolve-config-root-dir.js";
import { resolveDiagnoseTarget } from "./resolve-diagnose-target.js";
import type { ReactDoctorConfig } from "./types/index.js";

export interface ResolvedScanTarget {
  /** Absolute path the scan should run against. */
  readonly resolvedDirectory: string;
  /** The originally-requested directory, resolved to an absolute path. */
  readonly requestedDirectory: string;
  /** The loaded user config, or `null` when no config file was found. */
  readonly userConfig: ReactDoctorConfig | null;
  /**
   * Directory of the `react-doctor.config.json` / `package.json` that
   * supplied `userConfig`. `null` when no config was loaded. Used as
   * the resolution base for `userConfig.plugins` entries.
   */
  readonly configSourceDirectory: string | null;
  /**
   * `true` when the config's `rootDir` redirected the scan away from
   * the requested directory. Callers can use this to surface a
   * "redirected" hint to the user.
   */
  readonly didRedirectViaRootDir: boolean;
}

/**
 * The canonical entry-point translation shared by every public shell
 * (`inspect()`, `diagnose()`, and the CLI's `inspectAction`):
 *
 *   1. Resolve the requested directory to absolute.
 *   2. Load `react-doctor.config.(json|js)` / `package.json#reactDoctor`
 *      if present.
 *   3. Honor `config.rootDir` to redirect the scan to a nested
 *      project root, if configured.
 *   4. Walk into a nested React subproject when the requested
 *      directory has no `package.json` of its own (raises
 *      `AmbiguousProjectError` when multiple candidates exist).
 *
 * Throws `ProjectNotFoundError` when neither the requested directory
 * nor any discoverable nested project has a `package.json`.
 *
 * Before this helper existed, the same three-step dance was reproduced
 * in `api/diagnose.ts`, `react-doctor/inspect.ts`, and the CLI's
 * `cli/commands/inspect.ts` — each loading the config independently
 * (the orchestrator's `Config.layerNode` then loads it a fourth time
 * via its own cache). Routing through `resolveScanTarget` keeps every
 * shell in agreement on what "the scan directory" means.
 */
export const resolveScanTarget = (requestedDirectory: string): ResolvedScanTarget => {
  const absoluteRequested = path.resolve(requestedDirectory);
  const loadedConfig = loadConfigWithSource(absoluteRequested);
  const userConfig = loadedConfig?.config ?? null;
  const configSourceDirectory = loadedConfig?.sourceDirectory ?? null;
  const redirectedDirectory = resolveConfigRootDir(userConfig, configSourceDirectory);
  const directoryAfterRedirect = redirectedDirectory ?? absoluteRequested;
  // `resolveDiagnoseTarget` throws `AmbiguousProjectError` when the
  // requested directory has multiple React subprojects; let it
  // propagate to the caller.
  const resolved = resolveDiagnoseTarget(directoryAfterRedirect);
  const resolvedDirectory = resolved ?? directoryAfterRedirect;

  if (!isDirectory(resolvedDirectory)) {
    throw existsSync(resolvedDirectory)
      ? new NotADirectoryError(resolvedDirectory)
      : new ProjectNotFoundError(resolvedDirectory);
  }

  return {
    resolvedDirectory,
    requestedDirectory: absoluteRequested,
    userConfig,
    configSourceDirectory,
    didRedirectViaRootDir: redirectedDirectory !== null,
  };
};
