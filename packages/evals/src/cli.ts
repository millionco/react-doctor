import { FAILURE_EXIT_CODE } from "./constants.js";
import { parseEvaluationArguments } from "./parse-evaluation-arguments.js";
import { runCorpusEvaluation } from "./run-corpus-evaluation.js";

const main = async (): Promise<void> => {
  const options = parseEvaluationArguments(process.argv.slice(2));
  await runCorpusEvaluation(options);
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
});
