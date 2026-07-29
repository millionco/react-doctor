import { clearIgnorePatternsCache } from "./collect-ignore-patterns.js";
import { clearConfigCache } from "./load-config.js";
import { clearPackageJsonCache } from "./project-info/package-json.js";
import { clearProjectCache } from "./project-info/discover-project.js";
import { clearMinifiedFileCache } from "./utils/is-large-minified-file.js";
import { clearPackageRoleCache } from "./utils/classify-package-role.js";

export const clearCoreCaches = (): void => {
  clearProjectCache();
  clearConfigCache();
  clearPackageJsonCache();
  clearIgnorePatternsCache();
  clearPackageRoleCache();
  clearMinifiedFileCache();
};
