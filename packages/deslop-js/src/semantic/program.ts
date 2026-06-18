import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { SEMANTIC_MAX_PROGRAM_FILES, DEFAULT_SEMANTIC_TSCONFIG_NAMES } from "../constants.js";
import { type DeslopError, TypeScriptError, describeUnknownError } from "../errors.js";

export interface SemanticContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  rootSourceFiles: ts.SourceFile[];
  tsconfigPath: string;
}

export interface SemanticContextFailure {
  reason:
    | "no-tsconfig"
    | "tsconfig-parse-error"
    | "program-creation-failed"
    | "too-many-files"
    | "typescript-load-failed";
  message: string;
  error: DeslopError;
}

export type SemanticContextResult =
  | { ok: true; context: SemanticContext }
  | { ok: false; failure: SemanticContextFailure };

const failureFor = (
  reason: SemanticContextFailure["reason"],
  message: string,
  options: { rootDir: string; detail?: string } = { rootDir: "" },
): SemanticContextFailure => {
  const codeByReason: Record<
    SemanticContextFailure["reason"],
    | "tsconfig-not-found"
    | "tsconfig-parse-failed"
    | "ts-program-creation-failed"
    | "ts-program-too-large"
    | "ts-not-loadable"
  > = {
    "no-tsconfig": "tsconfig-not-found",
    "tsconfig-parse-error": "tsconfig-parse-failed",
    "program-creation-failed": "ts-program-creation-failed",
    "too-many-files": "ts-program-too-large",
    "typescript-load-failed": "ts-not-loadable",
  };
  return {
    reason,
    message,
    error: new TypeScriptError({
      code: codeByReason[reason],
      severity: reason === "no-tsconfig" ? "info" : "warning",
      message,
      path: options.rootDir || undefined,
      detail: options.detail,
    }),
  };
};

const findNearestTsconfig = (
  rootDir: string,
  explicitPath: string | undefined,
): string | undefined => {
  if (explicitPath) {
    const absoluteExplicit = resolve(rootDir, explicitPath);
    if (existsSync(absoluteExplicit)) return absoluteExplicit;
    return undefined;
  }
  for (const candidateName of DEFAULT_SEMANTIC_TSCONFIG_NAMES) {
    const candidatePath = resolve(rootDir, candidateName);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

export const createSemanticContext = (
  rootDir: string,
  tsconfigPath: string | undefined,
): SemanticContextResult => {
  const resolvedTsconfigPath = findNearestTsconfig(rootDir, tsconfigPath);
  if (!resolvedTsconfigPath) {
    return {
      ok: false,
      failure: failureFor("no-tsconfig", `No tsconfig found under ${rootDir}`, { rootDir }),
    };
  }

  let configFileContent: ReturnType<typeof ts.readConfigFile>;
  try {
    configFileContent = ts.readConfigFile(resolvedTsconfigPath, ts.sys.readFile);
  } catch (readError) {
    return {
      ok: false,
      failure: failureFor("tsconfig-parse-error", "ts.readConfigFile threw", {
        rootDir: resolvedTsconfigPath,
        detail: describeUnknownError(readError),
      }),
    };
  }
  if (configFileContent.error) {
    return {
      ok: false,
      failure: failureFor(
        "tsconfig-parse-error",
        ts.flattenDiagnosticMessageText(configFileContent.error.messageText, "\n"),
        { rootDir: resolvedTsconfigPath },
      ),
    };
  }

  let parsedCommandLine: ts.ParsedCommandLine;
  try {
    parsedCommandLine = ts.parseJsonConfigFileContent(
      configFileContent.config,
      ts.sys,
      dirname(resolvedTsconfigPath),
      {
        noEmit: true,
        skipLibCheck: true,
        allowJs: true,
        isolatedModules: false,
      },
      resolvedTsconfigPath,
    );
  } catch (parseError) {
    return {
      ok: false,
      failure: failureFor("tsconfig-parse-error", "ts.parseJsonConfigFileContent threw", {
        rootDir: resolvedTsconfigPath,
        detail: describeUnknownError(parseError),
      }),
    };
  }

  if (parsedCommandLine.errors.length > 0) {
    const fatalErrors = parsedCommandLine.errors.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (fatalErrors.length > 0 && parsedCommandLine.fileNames.length === 0) {
      return {
        ok: false,
        failure: failureFor(
          "tsconfig-parse-error",
          ts.flattenDiagnosticMessageText(fatalErrors[0].messageText, "\n"),
          { rootDir: resolvedTsconfigPath },
        ),
      };
    }
  }

  if (parsedCommandLine.fileNames.length > SEMANTIC_MAX_PROGRAM_FILES) {
    return {
      ok: false,
      failure: failureFor(
        "too-many-files",
        `Project has ${parsedCommandLine.fileNames.length} files, exceeds SEMANTIC_MAX_PROGRAM_FILES=${SEMANTIC_MAX_PROGRAM_FILES}`,
        { rootDir: resolvedTsconfigPath },
      ),
    };
  }

  try {
    const program = ts.createProgram({
      rootNames: parsedCommandLine.fileNames,
      options: parsedCommandLine.options,
      projectReferences: parsedCommandLine.projectReferences,
    });
    const checker = program.getTypeChecker();
    const rootSourceFiles = program
      .getSourceFiles()
      .filter(
        (sourceFile) => !sourceFile.isDeclarationFile || sourceFile.fileName.endsWith(".d.ts"),
      );

    return {
      ok: true,
      context: {
        program,
        checker,
        rootSourceFiles,
        tsconfigPath: resolvedTsconfigPath,
      },
    };
  } catch (programError) {
    return {
      ok: false,
      failure: failureFor("program-creation-failed", "ts.createProgram threw", {
        rootDir: resolvedTsconfigPath,
        detail: describeUnknownError(programError),
      }),
    };
  }
};
