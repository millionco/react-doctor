import { parentPort } from "node:worker_threads";
import { parseSourceFile } from "./parse.js";
import type { DeslopErrorJson } from "../errors.js";

interface ParseTaskMessage {
  readonly type: "parse";
  readonly filePath: string;
  readonly fileIndex: number;
}

type WorkerMessage = ParseTaskMessage;

interface SerializedParsedSource {
  readonly imports: ReturnType<typeof parseSourceFile>["imports"];
  readonly exports: ReturnType<typeof parseSourceFile>["exports"];
  readonly memberAccesses: ReturnType<typeof parseSourceFile>["memberAccesses"];
  readonly wholeObjectUses: string[];
  readonly localIdentifierReferences: string[];
  readonly referencedFilenames: string[];
  readonly redundantTypePatterns: ReturnType<typeof parseSourceFile>["redundantTypePatterns"];
  readonly identityWrappers: ReturnType<typeof parseSourceFile>["identityWrappers"];
  readonly typeDefinitionHashes: ReturnType<typeof parseSourceFile>["typeDefinitionHashes"];
  readonly inlineTypeLiterals: ReturnType<typeof parseSourceFile>["inlineTypeLiterals"];
  readonly simplifiableFunctions: ReturnType<typeof parseSourceFile>["simplifiableFunctions"];
  readonly simplifiableExpressions: ReturnType<typeof parseSourceFile>["simplifiableExpressions"];
  readonly duplicateConstantCandidates: ReturnType<
    typeof parseSourceFile
  >["duplicateConstantCandidates"];
  readonly errors: DeslopErrorJson[];
}

interface ParseResultMessage {
  readonly type: "result";
  readonly fileIndex: number;
  readonly filePath: string;
  readonly parsed: SerializedParsedSource;
}

interface ParseErrorMessage {
  readonly type: "error";
  readonly fileIndex: number;
  readonly filePath: string;
  readonly errorMessage: string;
}

const port = parentPort!;

port.on("message", (message: WorkerMessage) => {
  if (message.type === "parse") {
    try {
      const parsed = parseSourceFile(message.filePath);
      const response: ParseResultMessage = {
        type: "result",
        fileIndex: message.fileIndex,
        filePath: message.filePath,
        parsed: {
          imports: parsed.imports,
          exports: parsed.exports,
          memberAccesses: parsed.memberAccesses,
          wholeObjectUses: parsed.wholeObjectUses,
          localIdentifierReferences: parsed.localIdentifierReferences,
          referencedFilenames: parsed.referencedFilenames,
          redundantTypePatterns: parsed.redundantTypePatterns,
          identityWrappers: parsed.identityWrappers,
          typeDefinitionHashes: parsed.typeDefinitionHashes,
          inlineTypeLiterals: parsed.inlineTypeLiterals,
          simplifiableFunctions: parsed.simplifiableFunctions,
          simplifiableExpressions: parsed.simplifiableExpressions,
          duplicateConstantCandidates: parsed.duplicateConstantCandidates,
          errors: parsed.errors.map((deslopError) => deslopError.toJSON()),
        },
      };
      port.postMessage(response);
    } catch (taskError) {
      const response: ParseErrorMessage = {
        type: "error",
        fileIndex: message.fileIndex,
        filePath: message.filePath,
        errorMessage: taskError instanceof Error ? taskError.message : String(taskError),
      };
      port.postMessage(response);
    }
  }
});

port.postMessage({ type: "ready" });
