export class ReactDoctorError extends Error {
  override readonly name: string = "ReactDoctorError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProjectNotFoundError extends ReactDoctorError {
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

export class NoReactDependencyError extends ReactDoctorError {
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

export class PackageJsonNotFoundError extends ReactDoctorError {
  override readonly name = "PackageJsonNotFoundError";
  readonly directory: string;

  constructor(directory: string, options?: ErrorOptions) {
    super(`No package.json found in ${directory}`, options);
    this.directory = directory;
  }
}

export class AmbiguousProjectError extends ReactDoctorError {
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

export const isReactDoctorError = (value: unknown): value is ReactDoctorError =>
  value instanceof ReactDoctorError;
