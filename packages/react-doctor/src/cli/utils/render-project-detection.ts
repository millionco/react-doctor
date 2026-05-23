import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";
import { formatFrameworkName } from "@react-doctor/core";
import type { ProjectInfo, ReactDoctorConfig } from "@react-doctor/core";
import { spinner } from "./spinner.js";

export interface PrintProjectDetectionInput {
  readonly projectInfo: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly isDiffMode: boolean;
  readonly includePaths: ReadonlyArray<string>;
  readonly lintSourceFileCount: number | undefined;
}

/**
 * Each "completed step" is rendered by ora's `succeed` (writes a
 * green ✔ + the supplied label) — the ora handle is created, started,
 * and immediately succeeded so the user sees a static checklist
 * rather than a spinning frame for steps that finish synchronously.
 * The wrapping `Effect.sync` keeps the imperative IO inside the
 * Effect graph so cancellation / Console swap behave consistently
 * with the rest of the renderer.
 */
const completeStep = (message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    spinner(message).start().succeed(message);
  });

export const printProjectDetection = (input: PrintProjectDetectionInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    const frameworkLabel = formatFrameworkName(input.projectInfo.framework);
    const languageLabel = input.projectInfo.hasTypeScript ? "TypeScript" : "JavaScript";

    yield* completeStep(`Detecting framework. Found ${highlighter.info(frameworkLabel)}.`);
    yield* completeStep(
      `Detecting React version. Found ${highlighter.info(`React ${input.projectInfo.reactVersion}`)}.`,
    );
    yield* completeStep(
      `Detecting Tailwind. ${
        input.projectInfo.tailwindVersion
          ? `Found ${highlighter.info(`Tailwind ${input.projectInfo.tailwindVersion}`)}.`
          : "Not found."
      }`,
    );
    yield* completeStep(`Detecting language. Found ${highlighter.info(languageLabel)}.`);
    yield* completeStep(
      `Detecting React Compiler. ${input.projectInfo.hasReactCompiler ? highlighter.info("Found React Compiler.") : "Not found."}`,
    );

    if (input.isDiffMode) {
      yield* completeStep(
        `Scanning ${highlighter.info(`${input.includePaths.length}`)} changed source files.`,
      );
    } else {
      yield* completeStep(
        `Found ${highlighter.info(`${input.lintSourceFileCount ?? input.projectInfo.sourceFileCount}`)} source files.`,
      );
    }

    if (input.userConfig) {
      yield* completeStep(`Loaded ${highlighter.info("react-doctor config")}.`);
    }

    yield* Console.log("");
  });
