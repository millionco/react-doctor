import { getEvaluatorSourceHash } from "./utils/get-evaluator-source-hash.js";

process.stdout.write(`${getEvaluatorSourceHash()}\n`);
