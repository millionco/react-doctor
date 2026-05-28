/**
 * Narrow errors raised by the project-discovery helpers
 * (`discoverProject` / `resolveDiagnoseTarget` / `readPackageJson`).
 *
 * These extend `Error` directly — they are NOT the tagged
 * `ReactDoctorError` from `../errors.js` (that one wraps every
 * runtime-pipeline failure as a `Schema.TaggedErrorClass` for
 * `Effect.catchReasons` dispatch). The split is intentional:
 *
 * - Discovery happens BEFORE the Effect runtime takes over — at the
 *   `diagnose()` / CLI entry point — and throws plain JS exceptions
 *   so callers can `try/catch` without an Effect-layer-aware
 *   `instanceof` check.
 * - The Project service (`services/project.ts → translateProjectInfoError`)
 *   translates each of these into the equivalent tagged-error
 *   `reason` before re-raising inside the Effect pipeline, so the
 *   runtime never sees a non-tagged failure.
 *
 * If you're inside the Effect runtime, use the tagged
 * `ReactDoctorError` from `../errors.js` instead.
 */

export class ProjectNotFoundError extends Error {
  override readonly name = "ProjectNotFoundError";
  readonly directory: string;

  constructor(directory: string, options?: ErrorOptions) {
    super(
      `No React project found in ${directory}. Expected a package.json at the directory root or a nested package.json with a React dependency.`,
      options,
    );
    this.directory = directory;
  }
}

export class NoReactDependencyError extends Error {
  override readonly name = "NoReactDependencyError";
  readonly directory: string;

  constructor(directory: string, options?: ErrorOptions) {
    super(
      `No React dependency found in ${directory}/package.json. Add "react" to dependencies (or peerDependencies) and re-run.`,
      options,
    );
    this.directory = directory;
  }
}

export class PackageJsonNotFoundError extends Error {
  override readonly name = "PackageJsonNotFoundError";
  readonly directory: string;

  constructor(directory: string, options?: ErrorOptions) {
    super(`No package.json found in ${directory}`, options);
    this.directory = directory;
  }
}

export class NotADirectoryError extends Error {
  override readonly name = "NotADirectoryError";
  readonly resolvedPath: string;

  constructor(resolvedPath: string, options?: ErrorOptions) {
    super(
      `Resolved scan target "${resolvedPath}" is not a directory. Ensure the path exists and points to a project directory, not a file.`,
      options,
    );
    this.resolvedPath = resolvedPath;
  }
}

export class AmbiguousProjectError extends Error {
  override readonly name = "AmbiguousProjectError";
  readonly directory: string;
  readonly candidates: readonly string[];

  constructor(directory: string, candidates: readonly string[], options?: ErrorOptions) {
    super(
      `Multiple React projects found under ${directory} (${candidates.length} candidates): ${candidates.join(", ")}. Re-run diagnose() with one of those subdirectories, or iterate them yourself.`,
      options,
    );
    this.directory = directory;
    this.candidates = candidates;
  }
}

export const isProjectDiscoveryError = (
  value: unknown,
): value is
  | ProjectNotFoundError
  | NoReactDependencyError
  | PackageJsonNotFoundError
  | NotADirectoryError
  | AmbiguousProjectError =>
  value instanceof ProjectNotFoundError ||
  value instanceof NoReactDependencyError ||
  value instanceof PackageJsonNotFoundError ||
  value instanceof NotADirectoryError ||
  value instanceof AmbiguousProjectError;
