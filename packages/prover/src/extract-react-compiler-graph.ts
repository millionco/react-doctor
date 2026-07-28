import * as path from "node:path";
import { transformSync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";
import type {
  CompilerPipelineValue,
  Logger,
  LoggerEvent,
  SourceLocation,
} from "babel-plugin-react-compiler";
import {
  FIRST_SOURCE_COLUMN,
  FIRST_SOURCE_LINE,
  REACT_COMPILER_FACT_PHASE,
  REACT_COMPILER_VERSION,
} from "./constants.js";
import { ReactCompilerFactStatus } from "./types.js";
import type {
  ReactCompilerBlockFact,
  ReactCompilerFailure,
  ReactCompilerFunctionFact,
  ReactCompilerGraph,
  ReactCompilerInstructionFact,
  ReactProofLocation,
} from "./types.js";

const getCompilerLocation = (
  sourceLocation: SourceLocation | null,
  filePath: string,
): ReactProofLocation | null => {
  if (!sourceLocation || typeof sourceLocation === "symbol") return null;
  return {
    filePath,
    line: sourceLocation.start.line,
    column: sourceLocation.start.column + 1,
  };
};

const getDefaultLocation = (filePath: string): ReactProofLocation => ({
  filePath,
  line: FIRST_SOURCE_LINE,
  column: FIRST_SOURCE_COLUMN,
});

const normalizeCompilerFunction = (
  pipelineValue: CompilerPipelineValue,
  filePath: string,
): ReactCompilerFunctionFact | null => {
  if (pipelineValue.kind !== "hir" || pipelineValue.name !== REACT_COMPILER_FACT_PHASE) {
    return null;
  }
  const compilerFunction = pipelineValue.value;
  const successorsByBlockId = new Map<string, Set<string>>();
  for (const compilerBlock of compilerFunction.body.blocks.values()) {
    successorsByBlockId.set(String(compilerBlock.id), new Set());
  }
  for (const compilerBlock of compilerFunction.body.blocks.values()) {
    const blockId = String(compilerBlock.id);
    for (const predecessorId of compilerBlock.preds) {
      const predecessorSuccessors = successorsByBlockId.get(String(predecessorId));
      predecessorSuccessors?.add(blockId);
    }
  }
  const blocks: ReactCompilerBlockFact[] = [];
  for (const compilerBlock of compilerFunction.body.blocks.values()) {
    const instructions: ReactCompilerInstructionFact[] = compilerBlock.instructions.map(
      (instruction) => ({
        id: String(instruction.id),
        valueKind: instruction.value.kind,
        lvalueId: String(instruction.lvalue.identifier.id),
        effect: instruction.lvalue.effect,
        reactive: instruction.lvalue.reactive,
        location: getCompilerLocation(instruction.loc, filePath),
      }),
    );
    blocks.push({
      id: String(compilerBlock.id),
      kind: compilerBlock.kind,
      predecessors: [...compilerBlock.preds].map(String),
      successors: [...(successorsByBlockId.get(String(compilerBlock.id)) ?? [])],
      instructions,
      terminalKind: compilerBlock.terminal.kind,
    });
  }
  const location = getCompilerLocation(compilerFunction.loc, filePath);
  const start = location
    ? `${location.filePath}:${location.line}:${location.column}`
    : `${filePath}:generated`;
  return {
    id: `${start}:react-compiler-function`,
    functionType: compilerFunction.fnType,
    location,
    entryBlockId: String(compilerFunction.body.entry),
    blocks,
  };
};

const describeCompilerEvent = (event: LoggerEvent): string | null => {
  if (event.kind === "CompileError") return event.detail.reason;
  if (event.kind === "CompileDiagnostic") return event.detail.reason;
  if (event.kind === "CompileSkip") return event.reason;
  if (event.kind === "PipelineError") return event.data;
  return null;
};

const getCompilerEventLocation = (event: LoggerEvent, filePath: string): ReactProofLocation => {
  if (
    event.kind === "CompileError" ||
    event.kind === "CompileDiagnostic" ||
    event.kind === "CompileSkip" ||
    event.kind === "CompileSuccess"
  ) {
    return getCompilerLocation(event.fnLoc, filePath) ?? getDefaultLocation(filePath);
  }
  return getDefaultLocation(filePath);
};

const extractSourceCompilerFacts = (
  sourceText: string,
  filePath: string,
): {
  functions: ReadonlyArray<ReactCompilerFunctionFact>;
  failures: ReadonlyArray<ReactCompilerFailure>;
} => {
  const functions: ReactCompilerFunctionFact[] = [];
  const failures: ReactCompilerFailure[] = [];
  const logger: Logger = {
    logEvent: (_filename, event) => {
      const description = describeCompilerEvent(event);
      if (!description) return;
      failures.push({
        description,
        location: getCompilerEventLocation(event, filePath),
      });
    },
    debugLogIRs: (pipelineValue) => {
      const compilerFunction = normalizeCompilerFunction(pipelineValue, filePath);
      if (compilerFunction) functions.push(compilerFunction);
    },
  };
  try {
    transformSync(sourceText, {
      filename: filePath,
      babelrc: false,
      configFile: false,
      parserOpts: {
        plugins: ["typescript", "jsx"],
      },
      plugins: [
        [
          reactCompiler,
          {
            compilationMode: "infer",
            logger,
            panicThreshold: "none",
            target: "19",
          },
        ],
      ],
    });
  } catch (error) {
    failures.push({
      description: error instanceof Error ? error.message : "React Compiler extraction failed",
      location: getDefaultLocation(filePath),
    });
  }
  return { functions, failures };
};

export const extractReactCompilerGraph = (
  sourceFiles: ReadonlyArray<{ fileName: string; text: string }>,
  rootDirectory: string,
): ReactCompilerGraph => {
  const functions: ReactCompilerFunctionFact[] = [];
  const failures: ReactCompilerFailure[] = [];
  for (const sourceFile of sourceFiles) {
    const filePath = path.relative(rootDirectory, sourceFile.fileName);
    const sourceFacts = extractSourceCompilerFacts(sourceFile.text, filePath);
    functions.push(...sourceFacts.functions);
    failures.push(...sourceFacts.failures);
  }
  return {
    version: REACT_COMPILER_VERSION,
    phase: REACT_COMPILER_FACT_PHASE,
    status:
      failures.length > 0 ? ReactCompilerFactStatus.Incomplete : ReactCompilerFactStatus.Complete,
    functions,
    failures,
  };
};
