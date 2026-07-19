import { GENERATED_BUNDLE_FILE_PATTERN } from "../../../constants/security-scan.js";
import { isBrowserArtifactPath } from "./is-browser-artifact-path.js";

// Locale bundles (`public/locales/en/trace.json`) are translations whose
// FILENAMES echo product nouns like "trace"/"report", not debug dumps.
const LOCALE_DIRECTORY_PATTERN = /(?:^|\/)(?:locales?|i18n|lang|langs|translations?)\//i;
const PUBLIC_DEBUG_ARTIFACT_PATH_PATTERN =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|(?:debug|crash|trace|stack[-_]?trace|report|dump|phpinfo)(?:[-_.][^/]*)?\.(?:txt|log|json|html?)|[^/]+\.log)$/i;

export const isPublicDebugArtifactPath = (relativePath: string): boolean =>
  isBrowserArtifactPath(relativePath, GENERATED_BUNDLE_FILE_PATTERN.test(relativePath)) &&
  !LOCALE_DIRECTORY_PATTERN.test(relativePath) &&
  PUBLIC_DEBUG_ARTIFACT_PATH_PATTERN.test(relativePath);
