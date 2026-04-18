import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "../../types.js";
import type { DiagnoseCoreOptions } from "../../core/diagnose-core.js";
import { diagnoseCore } from "../../core/diagnose-core.js";
import { calculateScore as calculateScoreBrowser } from "../../utils/calculate-score-browser.js";
import { createBrowserReadFileLinesSync } from "./create-browser-read-file-lines.js";

export interface DiagnoseBrowserInput {
  rootDirectory: string;
  project: ProjectInfo;
  projectFiles: Record<string, string>;
  userConfig?: ReactDoctorConfig | null;
  runOxlint: (input: {
    lintIncludePaths: string[] | undefined;
    customRulesOnly: boolean;
  }) => Promise<Diagnostic[]>;
}

export const diagnoseBrowser = async (
  input: DiagnoseBrowserInput,
  options: DiagnoseCoreOptions = {},
) => {
  const readFileLinesSync = createBrowserReadFileLinesSync(input.rootDirectory, input.projectFiles);

  return diagnoseCore(
    {
      rootDirectory: input.rootDirectory,
      readFileLinesSync,
      loadUserConfig: () => input.userConfig ?? null,
      discoverProjectInfo: () => input.project,
      calculateDiagnosticsScore: calculateScoreBrowser,
      createRunners: ({ lintIncludePaths, userConfig }) => ({
        runLint: () =>
          input.runOxlint({
            lintIncludePaths,
            customRulesOnly: userConfig?.customRulesOnly ?? false,
          }),
        runDeadCode: async () => [],
      }),
    },
    options,
  );
};
