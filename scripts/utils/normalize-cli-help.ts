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
    .replaceAll(normalizedWorkingDirectory, "<cwd>");
  if (version === undefined) return normalizedOutput;
  return normalizedOutput.replaceAll(version, "<version>");
};
