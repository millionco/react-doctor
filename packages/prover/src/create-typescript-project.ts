import * as path from "node:path";
import ts from "typescript";
import { FIRST_SOURCE_COLUMN, FIRST_SOURCE_LINE } from "./constants.js";
import type { ReactProofEvidence } from "./types.js";

export interface TypeScriptProject {
  program?: ts.Program;
  evidence: ReadonlyArray<ReactProofEvidence>;
}

const createConfigEvidence = (
  rootDirectory: string,
  configPath: string,
  description: string,
): ReactProofEvidence => ({
  description,
  location: {
    filePath: path.relative(rootDirectory, configPath) || "tsconfig.json",
    line: FIRST_SOURCE_LINE,
    column: FIRST_SOURCE_COLUMN,
  },
  trace: ["project configuration", "TypeScript program", "React proof"],
});

export const createTypeScriptProject = (
  rootDirectory: string,
  requestedConfigPath?: string,
): TypeScriptProject => {
  const configPath =
    requestedConfigPath ??
    (ts.sys.fileExists(path.join(rootDirectory, "tsconfig.json"))
      ? path.join(rootDirectory, "tsconfig.json")
      : undefined);
  if (!configPath) {
    return {
      evidence: [
        createConfigEvidence(
          rootDirectory,
          path.join(rootDirectory, "tsconfig.json"),
          "No tsconfig.json was found for closed-world analysis",
        ),
      ],
    };
  }
  const absoluteConfigPath = path.resolve(rootDirectory, configPath);
  const configResult = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);
  if (configResult.error) {
    return {
      evidence: [
        createConfigEvidence(
          rootDirectory,
          absoluteConfigPath,
          ts.flattenDiagnosticMessageText(configResult.error.messageText, "\n"),
        ),
      ],
    };
  }
  const parsedConfig = ts.parseJsonConfigFileContent(
    configResult.config,
    ts.sys,
    path.dirname(absoluteConfigPath),
    undefined,
    absoluteConfigPath,
  );
  const evidence = parsedConfig.errors.map((diagnostic) =>
    createConfigEvidence(
      rootDirectory,
      absoluteConfigPath,
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ),
  );
  if (parsedConfig.fileNames.length === 0) {
    return {
      evidence: [
        ...evidence,
        createConfigEvidence(
          rootDirectory,
          absoluteConfigPath,
          "The TypeScript project contains no source files",
        ),
      ],
    };
  }
  return {
    program: ts.createProgram({
      rootNames: parsedConfig.fileNames,
      options: parsedConfig.options,
      projectReferences: parsedConfig.projectReferences,
    }),
    evidence,
  };
};
