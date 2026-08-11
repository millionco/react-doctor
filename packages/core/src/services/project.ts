import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  AmbiguousProjectError,
  discoverProject as discoverProjectSync,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  ProjectNotFoundError,
} from "../project-info/index.js";
import type { ProjectInfo } from "../types/index.js";
import {
  AmbiguousProject,
  NoReactDependency,
  ProjectDiscoveryFailed,
  ProjectNotFound,
  ReactDoctorError,
} from "../errors.js";

const translateProjectInfoError = (cause: unknown, directory: string): ReactDoctorError => {
  if (cause instanceof NoReactDependencyError) {
    return new ReactDoctorError({ reason: new NoReactDependency({ directory: cause.directory }) });
  }
  if (cause instanceof ProjectNotFoundError) {
    return new ReactDoctorError({ reason: new ProjectNotFound({ directory: cause.directory }) });
  }
  if (cause instanceof PackageJsonNotFoundError) {
    return new ReactDoctorError({ reason: new ProjectNotFound({ directory: cause.directory }) });
  }
  if (cause instanceof AmbiguousProjectError) {
    return new ReactDoctorError({
      reason: new AmbiguousProject({
        directory: cause.directory,
        candidates: cause.candidates,
      }),
    });
  }
  return new ReactDoctorError({ reason: new ProjectDiscoveryFailed({ directory, cause }) });
};

export interface ProjectDiscoveryInput {
  readonly directory: string;
  readonly sourceFileCount?: number;
}

export class Project extends Context.Service<
  Project,
  {
    readonly discover: (
      input: ProjectDiscoveryInput,
    ) => Effect.Effect<ProjectInfo, ReactDoctorError>;
  }
>()("react-doctor/Project") {
  static readonly layerNode = Layer.succeed(
    Project,
    Project.of({
      discover: Effect.fn("Project.discover")((input: ProjectDiscoveryInput) =>
        Effect.try({
          try: () =>
            discoverProjectSync(input.directory, { sourceFileCount: input.sourceFileCount }),
          catch: (cause) => translateProjectInfoError(cause, input.directory),
        }),
      ),
    }),
  );

  static readonly layerOf = (projectInfo: ProjectInfo): Layer.Layer<Project> =>
    Layer.succeed(
      Project,
      Project.of({
        discover: () => Effect.succeed(projectInfo),
      }),
    );
}
