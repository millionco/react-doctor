import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { SourceFile } from "../types.js";
import type { ParsedSource } from "./parse.js";
import { parseSourceFile } from "./parse.js";
import { DeslopError, type DeslopErrorJson, ParseError } from "../errors.js";
import { PARALLEL_PARSE_FILE_THRESHOLD } from "../constants.js";
import { resolveAvailableConcurrency } from "../utils/resolve-available-concurrency.js";

interface ParseResultMessage {
  readonly type: "result";
  readonly fileIndex: number;
  readonly filePath: string;
  readonly parsed: {
    readonly imports: ParsedSource["imports"];
    readonly exports: ParsedSource["exports"];
    readonly memberAccesses: ParsedSource["memberAccesses"];
    readonly wholeObjectUses: string[];
    readonly localIdentifierReferences: string[];
    readonly referencedFilenames: string[];
    readonly redundantTypePatterns: ParsedSource["redundantTypePatterns"];
    readonly identityWrappers: ParsedSource["identityWrappers"];
    readonly typeDefinitionHashes: ParsedSource["typeDefinitionHashes"];
    readonly inlineTypeLiterals: ParsedSource["inlineTypeLiterals"];
    readonly simplifiableFunctions: ParsedSource["simplifiableFunctions"];
    readonly simplifiableExpressions: ParsedSource["simplifiableExpressions"];
    readonly duplicateConstantCandidates: ParsedSource["duplicateConstantCandidates"];
    readonly errors: DeslopErrorJson[];
  };
}

interface ParseErrorMessage {
  readonly type: "error";
  readonly fileIndex: number;
  readonly filePath: string;
  readonly errorMessage: string;
}

type WorkerResponse = ParseResultMessage | ParseErrorMessage | { readonly type: "ready" };

const deserializeErrors = (serializedErrors: DeslopErrorJson[]): DeslopError[] =>
  serializedErrors.map(
    (errorJson) =>
      new DeslopError({
        code: errorJson.code,
        module: errorJson.module,
        severity: errorJson.severity,
        message: errorJson.message,
        path: errorJson.path,
        detail: errorJson.detail,
      }),
  );

const deserializeParsedSource = (serialized: ParseResultMessage["parsed"]): ParsedSource => ({
  imports: serialized.imports,
  exports: serialized.exports,
  memberAccesses: serialized.memberAccesses,
  wholeObjectUses: serialized.wholeObjectUses,
  localIdentifierReferences: serialized.localIdentifierReferences,
  referencedFilenames: serialized.referencedFilenames,
  redundantTypePatterns: serialized.redundantTypePatterns,
  identityWrappers: serialized.identityWrappers,
  typeDefinitionHashes: serialized.typeDefinitionHashes,
  inlineTypeLiterals: serialized.inlineTypeLiterals,
  simplifiableFunctions: serialized.simplifiableFunctions,
  simplifiableExpressions: serialized.simplifiableExpressions,
  duplicateConstantCandidates: serialized.duplicateConstantCandidates,
  errors: deserializeErrors(serialized.errors),
});

const resolveWorkerPath = (): string => {
  const currentUrl = import.meta.url;
  if (currentUrl.endsWith(".ts")) {
    return fileURLToPath(new URL("./parse-worker.ts", currentUrl));
  }
  return fileURLToPath(new URL("./parse-worker.mjs", currentUrl));
};

const createWorker = (workerPath: string): Worker => {
  const isTypeScript = workerPath.endsWith(".ts");
  return new Worker(workerPath, {
    ...(isTypeScript ? { execArgv: ["--import", "tsx"] } : {}),
  });
};

const waitForReady = (worker: Worker): Promise<void> =>
  new Promise((resolve, reject) => {
    const onMessage = (message: WorkerResponse): void => {
      if (message.type === "ready") {
        worker.off("message", onMessage);
        worker.off("error", onError);
        resolve();
      }
    };
    const onError = (error: Error): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      reject(error);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
  });

const parseFilesWithWorkerPool = async (
  files: ReadonlyArray<SourceFile>,
  workerCount: number,
): Promise<ParsedSource[]> => {
  const workerPath = resolveWorkerPath();
  const results: ParsedSource[] = new Array(files.length);
  const workers: Worker[] = [];

  try {
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
      workers.push(createWorker(workerPath));
    }
    await Promise.all(workers.map(waitForReady));
  } catch {
    for (const worker of workers) worker.terminate();
    return files.map((file) => parseSourceFile(file.path));
  }

  let nextFileIndex = 0;
  let completedCount = 0;

  return new Promise((resolve, reject) => {
    const dispatchNext = (worker: Worker): void => {
      if (nextFileIndex >= files.length) return;
      const fileIndex = nextFileIndex;
      nextFileIndex += 1;
      worker.postMessage({
        type: "parse",
        filePath: files[fileIndex].path,
        fileIndex,
      });
    };

    const onWorkerMessage = (worker: Worker) => (message: WorkerResponse) => {
      if (message.type === "result") {
        results[message.fileIndex] = deserializeParsedSource(message.parsed);
        completedCount += 1;
        if (completedCount === files.length) {
          cleanup();
          resolve(results);
        } else {
          dispatchNext(worker);
        }
      } else if (message.type === "error") {
        results[message.fileIndex] = {
          imports: [],
          exports: [],
          memberAccesses: [],
          wholeObjectUses: [],
          localIdentifierReferences: [],
          referencedFilenames: [],
          redundantTypePatterns: [],
          identityWrappers: [],
          typeDefinitionHashes: [],
          inlineTypeLiterals: [],
          simplifiableFunctions: [],
          simplifiableExpressions: [],
          duplicateConstantCandidates: [],
          errors: [
            new ParseError({
              code: "parse-failed",
              message: `Worker parse failed: ${message.errorMessage}`,
              path: message.filePath,
            }),
          ],
        };
        completedCount += 1;
        if (completedCount === files.length) {
          cleanup();
          resolve(results);
        } else {
          dispatchNext(worker);
        }
      }
    };

    const cleanup = (): void => {
      for (const worker of workers) {
        worker.terminate();
      }
    };

    for (const worker of workers) {
      worker.on("message", onWorkerMessage(worker));
      worker.on("error", (error) => {
        cleanup();
        reject(error);
      });
    }

    for (const worker of workers) {
      dispatchNext(worker);
    }
  });
};

export const parseFilesInParallel = async (
  files: ReadonlyArray<SourceFile>,
): Promise<ParsedSource[]> => {
  if (files.length <= PARALLEL_PARSE_FILE_THRESHOLD) {
    return files.map((file) => parseSourceFile(file.path));
  }

  const concurrency = resolveAvailableConcurrency();
  if (concurrency <= 1) {
    return files.map((file) => parseSourceFile(file.path));
  }

  try {
    return await parseFilesWithWorkerPool(files, concurrency);
  } catch {
    return files.map((file) => parseSourceFile(file.path));
  }
};
