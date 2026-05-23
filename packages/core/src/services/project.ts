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
      // `Effect.fn("Project.discover")` adds an OTel-compatible span
      // name to every invocation. Canonical eval pattern from
      // `react-doctor-evals/src/Runner.ts` / `ReactDoctorV2.ts` —
      // free observability with zero runtime cost when no tracer
      // layer is provided.
      discover: Effect.fn("Project.discover")(function* (directory: string) {
        return yield* Effect.try({
          try: () => discoverProjectSync(directory),
          catch: (cause) => translateProjectInfoError(cause, directory),
        });
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
