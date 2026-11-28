import { isAbsolute, relative, sep } from "node:path";
import {
  getReactDoctorStringArraySetting,
  getReactDoctorStringSetting,
} from "./get-react-doctor-setting.js";
import { isPathInside } from "./is-path-inside.js";
import type { RuleContext } from "./rule-context.js";

const JSX_COMPILER_PRAGMA_PATTERN = /@jsx(?:Runtime|ImportSource|Frag|Factory)?\b/i;

export const usesConfiguredAutomaticJsxRuntime = (context: RuleContext): boolean => {
  const files = getReactDoctorStringArraySetting(context.settings, "automaticJsxRuntimeFiles");
  if (files.length === 0) return false;
  const filename = context.filename;
  const root = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!filename || !root || !isAbsolute(filename) || !isAbsolute(root)) return false;
  if (!isPathInside(filename, root)) return false;
  const sourcePath = relative(root, filename).split(sep).join("/");
  if (!files.includes(sourcePath)) return false;
  const source = context.getSourceText?.() ?? context.sourceCode?.getText?.();
  return Boolean(source && !JSX_COMPILER_PRAGMA_PATTERN.test(source));
};
