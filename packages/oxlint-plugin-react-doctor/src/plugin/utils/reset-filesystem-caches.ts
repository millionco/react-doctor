import { resetManifestCaches } from "./read-nearest-package-manifest.js";
import { resetCrossFileExportCaches } from "./resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "./resolve-relative-import-path.js";
import { resetStaticProjectDomIdCache } from "./get-static-project-dom-ids.js";
import { resetTsconfigAliasCaches } from "./resolve-tsconfig-alias.js";

export const resetFilesystemCaches = (): void => {
  resetCrossFileExportCaches();
  resetManifestCaches();
  resetModuleResolutionCaches();
  resetStaticProjectDomIdCache();
  resetTsconfigAliasCaches();
};
