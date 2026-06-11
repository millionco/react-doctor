import { GENERATED_BUNDLE_FILE_PATTERN } from "../../../constants/security-scan.js";
import { isBrowserArtifactPath } from "./is-browser-artifact-path.js";

// Locale bundles (`public/locales/en/trace.json`) are translations whose
// FILENAMES echo product nouns like "trace"/"report", not debug dumps.
const LOCALE_DIRECTORY_PATTERN = /(?:^|\/)(?:locales?|i18n|lang|langs|translations?)\//i;

export const isPublicDebugArtifactPath = (relativePath: string): boolean =>
  isBrowserArtifactPath(relativePath, GENERATED_BUNDLE_FILE_PATTERN.test(relativePath)) &&
  !LOCALE_DIRECTORY_PATTERN.test(relativePath) &&
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]*(?:debug|crash|trace|stack|report|dump|phpinfo)[^/]*\.(?:txt|log|json|html?)|[^/]+\.log)$/i.test(
    relativePath,
  );
