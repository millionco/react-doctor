import { buildNoReactDependencyError } from "./constants.js";

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
    super(buildNoReactDependencyError(directory), options);
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

export const isReactDoctorError = (value: unknown): value is ReactDoctorError =>
  value instanceof ReactDoctorError;
