import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";
import { formatFrameworkName } from "@react-doctor/core";
import type { ProjectInfo, ReactDoctorConfig } from "@react-doctor/core";

export interface PrintProjectDetectionInput {
  readonly projectInfo: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly isDiffMode: boolean;
  readonly includePaths: ReadonlyArray<string>;
  readonly lintSourceFileCount: number | undefined;
}

const buildProjectSummaryParts = (input: PrintProjectDetectionInput): string[] => {
  const parts: string[] = [];
  parts.push(highlighter.info(formatFrameworkName(input.projectInfo.framework)));
  parts.push(highlighter.info(`React ${input.projectInfo.reactVersion}`));
  parts.push(highlighter.info(input.projectInfo.hasTypeScript ? "TypeScript" : "JavaScript"));
  if (input.projectInfo.tailwindVersion) {
    parts.push(highlighter.info(`Tailwind ${input.projectInfo.tailwindVersion}`));
  }
  if (input.projectInfo.hasReactCompiler) {
    parts.push(highlighter.info("React Compiler"));
  }
  return parts;
};

const buildFileCountLabel = (input: PrintProjectDetectionInput): string => {
  if (input.isDiffMode) {
    return `${highlighter.info(`${input.includePaths.length}`)} changed files`;
  }
  const fileCount = input.lintSourceFileCount ?? input.projectInfo.sourceFileCount;
  return `${highlighter.info(`${fileCount}`)} files`;
};

export const printProjectDetection = (input: PrintProjectDetectionInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    const projectParts = buildProjectSummaryParts(input);
    const fileCountLabel = buildFileCountLabel(input);
    const configLabel = input.userConfig ? ` · ${highlighter.info("config loaded")}` : "";
    yield* Console.log(`  ${projectParts.join(" · ")} · ${fileCountLabel}${configLabel}`);
    yield* Console.log("");
  });
