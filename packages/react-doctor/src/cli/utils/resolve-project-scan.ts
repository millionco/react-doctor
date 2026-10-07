import { mergeReactDoctorConfigs, resolveScanTarget } from "@react-doctor/core";
import type { ReactDoctorConfig, ResolvedScanTarget } from "@react-doctor/core";

export interface ResolvedProjectScan {
  readonly directory: string;
  readonly config: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
}

export const resolveProjectScan = async (
  rootScanTarget: ResolvedScanTarget,
  projectDirectory: string,
): Promise<ResolvedProjectScan> => {
  const projectScanTarget =
    projectDirectory === rootScanTarget.resolvedDirectory
      ? rootScanTarget
      : await resolveScanTarget(projectDirectory, { allowAmbiguous: true });
  return {
    directory: projectScanTarget.resolvedDirectory,
    config:
      projectDirectory === rootScanTarget.resolvedDirectory
        ? rootScanTarget.userConfig
        : mergeReactDoctorConfigs(
            rootScanTarget.userConfig,
            projectScanTarget.userConfig ?? undefined,
          ),
    configSourceDirectory:
      projectScanTarget.userConfig?.plugins === undefined
        ? rootScanTarget.configSourceDirectory
        : projectScanTarget.configSourceDirectory,
  };
};
