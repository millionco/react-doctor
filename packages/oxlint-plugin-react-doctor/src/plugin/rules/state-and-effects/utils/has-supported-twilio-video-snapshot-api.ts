import { comparePackageVersions } from "../../../utils/compare-package-versions.js";
import { resolvePackageVersion } from "../../../utils/resolve-package-version.js";
import { SDK_SNAPSHOT_DECLARED_RANGE, SDK_SNAPSHOT_SUPPORTED_VERSION } from "./constants.js";

export const hasSupportedTwilioVideoSnapshotApi = (filename: string | undefined): boolean => {
  const resolved = resolvePackageVersion(filename, "twilio-video", {
    rejectInvalidResolvedManifest: true,
  });
  return Boolean(
    resolved &&
    !resolved.version.isPrerelease &&
    comparePackageVersions(resolved.version, SDK_SNAPSHOT_SUPPORTED_VERSION) === 0 &&
    (resolved.declaredRange === null || resolved.declaredRange === SDK_SNAPSHOT_DECLARED_RANGE),
  );
};
