import { stripVTControlCharacters } from "node:util";

export const normalizeCliHelp = (
  output: string,
  workingDirectory: string,
  version?: string,
): string => {
  const normalizedWorkingDirectory = workingDirectory.replaceAll("\\", "/");
  const normalizedOutput = stripVTControlCharacters(output)
    .replace(/\r\n?/g, "\n")
    .replaceAll(workingDirectory, "<cwd>")
    .replaceAll(normalizedWorkingDirectory, "<cwd>")
    .replace(
      /working\s+directory\s+\(default:\s+"[^"]*"\)/g,
      'working directory (default: "<cwd>")',
    );
  return version === undefined
    ? normalizedOutput
    : normalizedOutput.replaceAll(version, "<version>");
};
