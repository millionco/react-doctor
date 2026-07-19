import * as fs from "node:fs";
import * as path from "node:path";

const REACT_DOCTOR_IGNORE_ENTRY = ".react-doctor/";

const hasReactDoctorIgnoreEntry = (content: string): boolean =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === REACT_DOCTOR_IGNORE_ENTRY || line === ".react-doctor");

export const ensureReactDoctorGitignore = (projectRoot: string): boolean => {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  try {
    const currentContent = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, "utf8")
      : "";
    if (hasReactDoctorIgnoreEntry(currentContent)) return false;
    const separator = currentContent.length === 0 || currentContent.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(gitignorePath, `${currentContent}${separator}${REACT_DOCTOR_IGNORE_ENTRY}\n`);
    return true;
  } catch {
    return false;
  }
};
