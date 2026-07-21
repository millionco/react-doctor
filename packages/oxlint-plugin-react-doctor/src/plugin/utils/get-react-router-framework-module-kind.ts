import * as path from "node:path";
import { getProjectRelativeFilename } from "./get-project-relative-filename.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { normalizeFilename } from "./normalize-filename.js";
import type { RuleContext } from "./rule-context.js";

const REACT_ROUTER_ROUTE_DIRECTORY_PATTERN = /(?:^|\/)app\/routes\//;
const REACT_ROUTER_ROOT_FILE_PATTERN = /(?:^|\/)app\/root\.(?:jsx?|tsx?)$/;
const REACT_ROUTER_ENTRY_FILE_PATTERN = /(?:^|\/)app\/entry\.(?:client|server)\.(?:jsx?|tsx?)$/;

export const getReactRouterFrameworkModuleKind = (
  context: Pick<RuleContext, "filename" | "settings">,
): "entry" | "root" | "route" | null => {
  const filename = normalizeFilename(context.filename ?? "");
  if (filename.length === 0) return null;

  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const projectRelativeFilename = getProjectRelativeFilename(filename, rootDirectory);
  if (rootDirectory && path.isAbsolute(filename) && projectRelativeFilename === filename) {
    return null;
  }
  if (REACT_ROUTER_ROUTE_DIRECTORY_PATTERN.test(projectRelativeFilename)) return "route";
  if (REACT_ROUTER_ROOT_FILE_PATTERN.test(projectRelativeFilename)) return "root";
  if (REACT_ROUTER_ENTRY_FILE_PATTERN.test(projectRelativeFilename)) return "entry";
  return null;
};
