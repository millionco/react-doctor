import { classifyPackagePlatform } from "./classify-package-platform.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { normalizeFilename } from "./normalize-filename.js";
import type { RuleContext } from "./rule-context.js";

export const isExpoManagedFileActive = (context: RuleContext): boolean => {
  const rawFilename = context.filename;
  const filename = rawFilename ? normalizeFilename(rawFilename) : undefined;
  if (filename) {
    const packagePlatform = classifyPackagePlatform(filename);
    if (packagePlatform === "expo") return true;
    if (packagePlatform === "react-native" || packagePlatform === "web") return false;
  }

  const framework = getReactDoctorStringSetting(context.settings, "framework");
  return framework === "expo";
};
