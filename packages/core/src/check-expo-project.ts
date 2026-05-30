import type { Diagnostic, ProjectInfo } from "./types/index.js";
import { checkExpoCliDependencies } from "./checks/expo/check-cli-dependencies.js";
import { checkExpoDependencyOverrides } from "./checks/expo/check-dependency-overrides.js";
import { checkExpoEnvLocalFiles } from "./checks/expo/check-env-local-files.js";
import { checkExpoGitignore } from "./checks/expo/check-gitignore.js";
import { checkExpoIllegalPackages } from "./checks/expo/check-illegal-packages.js";
import { checkExpoLockfile } from "./checks/expo/check-lockfile.js";
import { checkExpoMetroConfig } from "./checks/expo/check-metro-config.js";
import { checkExpoPackageJsonConflicts } from "./checks/expo/check-package-json-conflicts.js";
import { checkExpoRedundantDependencies } from "./checks/expo/check-redundant-dependencies.js";
import { checkExpoRouterReactNavigation } from "./checks/expo/check-router-react-navigation.js";
import { checkExpoVectorIcons } from "./checks/expo/check-vector-icons.js";

// The react-doctor port of expo-doctor's check suite. Each sub-check is the
// statically-determinable subset of an expo-doctor check (the originals
// also run the Expo CLI, hit the Expo API, and inspect native iOS/Android
// projects — none of which fit react-doctor's offline, static model).
//
// Gated entirely on `project.isExpoProject` so none of these fire on a
// non-Expo React project; the run-inspect orchestrator additionally skips
// the whole phase in diff/staged mode (these are whole-project findings).
export const checkExpoProject = (rootDirectory: string, project: ProjectInfo): Diagnostic[] => {
  if (!project.isExpoProject) return [];

  return [
    ...checkExpoIllegalPackages(rootDirectory),
    ...checkExpoCliDependencies(rootDirectory),
    ...checkExpoRedundantDependencies(rootDirectory),
    ...checkExpoDependencyOverrides(rootDirectory),
    ...checkExpoRouterReactNavigation(rootDirectory),
    ...checkExpoVectorIcons(rootDirectory),
    ...checkExpoPackageJsonConflicts(rootDirectory),
    ...checkExpoLockfile(rootDirectory),
    ...checkExpoGitignore(rootDirectory),
    ...checkExpoEnvLocalFiles(rootDirectory),
    ...checkExpoMetroConfig(rootDirectory),
  ];
};
