import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  AmbiguousProjectError,
  discoverProject as discoverProjectSync,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  ProjectNotFoundError,
} from "@react-doctor/project-info";
import type { ProjectInfo } from "@react-doctor/types";
import {
  AmbiguousProject,
  NoReactDependency,
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
  return new ReactDoctorError({ reason: new ProjectNotFound({ directory }) });
};

export class Project extends Context.Service<
  Project,
  {
    readonly discover: (directory: string) => Effect.Effect<ProjectInfo, ReactDoctorError>;
  }
>()("react-doctor/Project") {
  static readonly layerNode = Layer.succeed(
    Project,
    Project.of({
      discover: (directory) =>
        Effect.try({
          try: () => discoverProjectSync(directory),
          catch: (cause) => translateProjectInfoError(cause, directory),
        }),
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
