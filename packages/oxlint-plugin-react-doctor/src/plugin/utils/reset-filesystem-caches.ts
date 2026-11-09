import { clearExhaustiveDepsSuppressionCache } from "../rules/react-builtins/exhaustive-deps-suppression.js";
import { clearRulesOfHooksSuppressionCache } from "../rules/react-builtins/rules-of-hooks-suppression.js";
import { resetStaticProjectDomIdCache } from "./get-static-project-dom-ids.js";
import { resetRealDirectoryCache } from "./is-package-within-project-root.js";
import { resetBundlerIgnoreAnnotatedFileTextCache } from "./read-bundler-ignore-annotated-file-text.js";
import { resetManifestCaches } from "./read-nearest-package-manifest.js";
import { resetCrossFileExportCaches } from "./resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "./resolve-relative-import-path.js";
import { resetTsconfigAliasCaches } from "./resolve-tsconfig-alias.js";

export const resetFilesystemCaches = (): void => {
  resetBundlerIgnoreAnnotatedFileTextCache();
  resetCrossFileExportCaches();
  clearExhaustiveDepsSuppressionCache();
  clearRulesOfHooksSuppressionCache();
  resetManifestCaches();
  resetModuleResolutionCaches();
  resetRealDirectoryCache();
  resetStaticProjectDomIdCache();
  resetTsconfigAliasCaches();
};
