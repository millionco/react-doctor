import type { ReactDoctorConfig } from "../types/config.js";
import type { ProjectInfo } from "../types/project-info.js";
import { formatFrameworkName } from "../core/detection/discover-project.js";
import { highlighter } from "../core/highlighter.js";
import { logger } from "../core/logger.js";
import { spinner } from "./spinner.js";

export const printProjectDetection = (
  projectInfo: ProjectInfo,
  userConfig: ReactDoctorConfig | null,
  isDiffMode: boolean,
  includePaths: string[],
  lintSourceFileCount?: number,
): void => {
  const frameworkLabel = formatFrameworkName(projectInfo.framework);
  const languageLabel = projectInfo.hasTypeScript ? "TypeScript" : "JavaScript";

  const completeStep = (message: string) => {
    spinner(message).start().succeed(message);
  };

  completeStep(`Detecting framework. Found ${highlighter.info(frameworkLabel)}.`);
  completeStep(
    `Detecting React version. Found ${highlighter.info(`React ${projectInfo.reactVersion}`)}.`,
  );
  completeStep(
    `Detecting Tailwind. ${
      projectInfo.tailwindVersion
        ? `Found ${highlighter.info(`Tailwind ${projectInfo.tailwindVersion}`)}.`
        : "Not found."
    }`,
  );
  completeStep(`Detecting language. Found ${highlighter.info(languageLabel)}.`);
  completeStep(
    `Detecting React Compiler. ${projectInfo.hasReactCompiler ? highlighter.info("Found React Compiler.") : "Not found."}`,
  );

  if (isDiffMode) {
    completeStep(`Scanning ${highlighter.info(`${includePaths.length}`)} changed source files.`);
  } else {
    completeStep(
      `Found ${highlighter.info(`${lintSourceFileCount ?? projectInfo.sourceFileCount}`)} source files.`,
    );
  }

  if (userConfig) {
    completeStep(`Loaded ${highlighter.info("react-doctor config")}.`);
  }

  logger.break();
};
