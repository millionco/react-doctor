import {
  analyzeProjectForWorker,
  type AnalyzeProjectInput,
} from "./project-analysis/analyze-project.js";

interface SerializedProjectAnalysisError {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

interface ProjectAnalysisWorkerSuccess {
  readonly ok: true;
  readonly result: Awaited<ReturnType<typeof analyzeProjectForWorker>>;
}

interface ProjectAnalysisWorkerFailure {
  readonly ok: false;
  readonly error: SerializedProjectAnalysisError;
}

const serializeError = (error: unknown): SerializedProjectAnalysisError =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };

const emit = (message: ProjectAnalysisWorkerSuccess | ProjectAnalysisWorkerFailure): void => {
  process.stdout.write(JSON.stringify(message), () => process.exit(0));
};

export const startProjectAnalysisWorker = (): void => {
  const inputChunks: Buffer[] = [];
  process.stdin.on("data", (chunk: Buffer) => inputChunks.push(chunk));
  process.stdin.on("end", () => {
    void (async () => {
      try {
        const input: AnalyzeProjectInput = JSON.parse(Buffer.concat(inputChunks).toString("utf8"));
        const result = await analyzeProjectForWorker(input);
        emit({ ok: true, result });
      } catch (error) {
        emit({ ok: false, error: serializeError(error) });
      }
    })();
  });
};
