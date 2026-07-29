import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { checkExpoProject } from "../check-expo-project.js";
import { checkPnpmHardening } from "../check-pnpm-hardening.js";
import { checkReactNativeProject } from "../check-react-native-project.js";
import { checkReactServerComponentsAdvisory } from "../check-react-server-components-advisory.js";
import { checkReducedMotion } from "../check-reduced-motion.js";
import type { Diagnostic, ProjectInfo } from "../types/index.js";

export interface ProjectChecksInput {
  readonly rootDirectory: string;
  readonly project: ProjectInfo;
}

export class ProjectChecks extends Context.Service<
  ProjectChecks,
  {
    readonly run: (input: ProjectChecksInput) => Effect.Effect<ReadonlyArray<Diagnostic>>;
  }
>()("react-doctor/ProjectChecks") {
  static readonly layerNode = Layer.succeed(
    ProjectChecks,
    ProjectChecks.of({
      run: Effect.fn("ProjectChecks.run")((input: ProjectChecksInput) =>
        Effect.sync(() => [
          ...checkReducedMotion(input.rootDirectory),
          ...checkPnpmHardening(input.rootDirectory),
          ...checkReactServerComponentsAdvisory(input.rootDirectory, input.project),
          ...checkExpoProject(input.rootDirectory, input.project),
          ...checkReactNativeProject(input.rootDirectory, input.project),
        ]),
      ),
    }),
  );

  static readonly layerOf = (diagnostics: ReadonlyArray<Diagnostic>): Layer.Layer<ProjectChecks> =>
    Layer.succeed(
      ProjectChecks,
      ProjectChecks.of({
        run: () => Effect.succeed(diagnostics),
      }),
    );
}
