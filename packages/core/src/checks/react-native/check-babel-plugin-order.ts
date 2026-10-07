import { REANIMATED_WORKLETS_MINIMUM_MAJOR_VERSION } from "../../constants.js";
import { getLowestDependencyMajor } from "../../project-info/version.js";
import type { Diagnostic, ProjectInfo } from "../../types/index.js";
import { buildReactNativeDiagnostic } from "./utils/build-react-native-diagnostic.js";
import { readStaticBabelPluginNames } from "./utils/read-static-babel-plugin-names.js";

const REACT_COMPILER_PLUGIN_NAMES = new Set(["babel-plugin-react-compiler", "react-compiler"]);
const REANIMATED_PLUGIN_NAME = "react-native-reanimated/plugin";
const WORKLETS_PLUGIN_NAME = "react-native-worklets/plugin";

const checkReactCompilerPluginOrder = (
  filePath: string,
  pluginNames: ReadonlyArray<string>,
): Diagnostic[] => {
  const compilerPluginIndex = pluginNames.findIndex((pluginName) =>
    REACT_COMPILER_PLUGIN_NAMES.has(pluginName),
  );
  if (compilerPluginIndex <= 0) return [];
  return [
    buildReactNativeDiagnostic({
      filePath,
      rule: "rn-react-compiler-plugin-first",
      category: "Performance",
      message:
        "The React Compiler Babel plugin is not first, so an earlier transform can change component or hook code before the compiler analyzes it.",
      help: "Move `babel-plugin-react-compiler` to the first entry in the Babel `plugins` array.",
    }),
  ];
};

const checkReanimatedPluginOrder = (
  project: ProjectInfo,
  filePath: string,
  pluginNames: ReadonlyArray<string>,
): Diagnostic[] => {
  const reanimatedMajorVersion =
    project.reanimatedVersion === null || project.reanimatedVersion === undefined
      ? null
      : getLowestDependencyMajor(project.reanimatedVersion);
  if (
    reanimatedMajorVersion === null ||
    reanimatedMajorVersion < REANIMATED_WORKLETS_MINIMUM_MAJOR_VERSION
  ) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  if (pluginNames.includes(REANIMATED_PLUGIN_NAME)) {
    diagnostics.push(
      buildReactNativeDiagnostic({
        filePath,
        rule: "rn-reanimated-worklets-plugin-last",
        category: "Performance",
        message:
          "This Reanimated 4 project still uses `react-native-reanimated/plugin`, which was renamed to the Worklets Babel plugin.",
        help: "Replace it with `react-native-worklets/plugin` and keep that plugin last in the Babel `plugins` array.",
      }),
    );
  }

  const workletsPluginIndex = pluginNames.lastIndexOf(WORKLETS_PLUGIN_NAME);
  if (workletsPluginIndex !== -1 && workletsPluginIndex !== pluginNames.length - 1) {
    diagnostics.push(
      buildReactNativeDiagnostic({
        filePath,
        rule: "rn-reanimated-worklets-plugin-last",
        category: "Performance",
        message:
          "`react-native-worklets/plugin` is not last in the Babel `plugins` array, so later transforms can prevent worklets from being compiled correctly.",
        help: "Move `react-native-worklets/plugin` to the final entry in the Babel `plugins` array.",
      }),
    );
  }
  return diagnostics;
};

export const checkReactNativeBabelPluginOrder = (
  rootDirectory: string,
  project: ProjectInfo,
): Diagnostic[] => {
  const babelPlugins = readStaticBabelPluginNames(rootDirectory);
  if (babelPlugins === null || babelPlugins.pluginNames === null) return [];
  return [
    ...checkReactCompilerPluginOrder(babelPlugins.filePath, babelPlugins.pluginNames),
    ...checkReanimatedPluginOrder(project, babelPlugins.filePath, babelPlugins.pluginNames),
  ];
};
