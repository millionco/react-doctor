import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";

const SOURCE_FILE_GLOB = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs,es6}";
const DIRECTORY_ASSIGNMENT_PATTERN =
  /\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*path\.(?:join|resolve)\(\s*(process\.cwd\(\)|__dirname|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*,([^;)]+)\)/g;
const STRING_LITERAL_PATTERN = /["']([^"']+)["']/g;

const isRuntimeConsumed = (source: string, identifierName: string): boolean => {
  const escapedName = identifierName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b(?:listSync|readdirSync|copySync)\\s*\\(\\s*${escapedName}\\b|\\breaddir\\s*\\(\\s*${escapedName}\\b`,
  ).test(source);
};

export const extractRuntimeConsumedDirectoryFiles = (directory: string): string[] => {
  const consumedFiles = new Set<string>();
  const sourcePaths = fg.sync(SOURCE_FILE_GLOB, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  });
  for (const sourcePath of sourcePaths) {
    let source = "";
    try {
      source = readFileSync(sourcePath, "utf-8");
    } catch {
      continue;
    }
    DIRECTORY_ASSIGNMENT_PATTERN.lastIndex = 0;
    let assignmentMatch: RegExpExecArray | null;
    while ((assignmentMatch = DIRECTORY_ASSIGNMENT_PATTERN.exec(source)) !== null) {
      if (!isRuntimeConsumed(source, assignmentMatch[1])) continue;
      const pathSegments: string[] = [];
      STRING_LITERAL_PATTERN.lastIndex = 0;
      let segmentMatch: RegExpExecArray | null;
      while ((segmentMatch = STRING_LITERAL_PATTERN.exec(assignmentMatch[3])) !== null) {
        pathSegments.push(segmentMatch[1]);
      }
      if (pathSegments.length === 0) continue;
      const firstArgument = assignmentMatch[2];
      const baseDirectory = firstArgument === "__dirname" ? dirname(sourcePath) : directory;
      if (
        firstArgument !== "__dirname" &&
        firstArgument !== "process.cwd()" &&
        !/(?:root|resource|project|cwd)/i.test(firstArgument)
      ) {
        continue;
      }
      const consumedDirectory = resolve(baseDirectory, ...pathSegments);
      for (const consumedFile of fg.sync(SOURCE_FILE_GLOB, {
        cwd: consumedDirectory,
        absolute: true,
        onlyFiles: true,
      })) {
        consumedFiles.add(consumedFile);
      }
    }
  }
  return [...consumedFiles];
};
