import { getProjectRelativeFilename } from "./get-project-relative-filename.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { normalizeFilename } from "./normalize-filename.js";
import type { RuleContext } from "./rule-context.js";

// True when the linted file sits under `directoryPath` (e.g. "app",
// "pages/api") within the project. When core provides the project root
// via `settings["react-doctor"].rootDirectory`, the check runs on the
// project-relative path, so a repo checked out at a matching absolute
// directory (e.g. a container mounted at `/app`) is never misread as a
// framework directory. Without a root, the leading segment of an
// absolute path is treated as a mount point and ignored.
export const isInProjectDirectory = (
  context: Pick<RuleContext, "filename" | "settings">,
  directoryPath: string,
): boolean => {
  const filename = normalizeFilename(context.filename ?? "");
  if (filename.length === 0) return false;

  const directorySegment = `/${directoryPath}/`;
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const relativeFilename = getProjectRelativeFilename(filename, rootDirectory);
  if (relativeFilename !== filename) {
    return (
      relativeFilename.startsWith(`${directoryPath}/`) ||
      relativeFilename.includes(directorySegment)
    );
  }

  return filename.indexOf(directorySegment, 1) !== -1;
};
