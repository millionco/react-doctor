import * as fs from "node:fs";
import * as path from "node:path";
import { COOPERATIVE_YIELD_BUDGET_MS } from "../constants.js";
import { remainingDeadlineBudgetMs } from "./remaining-deadline-budget-ms.js";
import { yieldToEventLoop } from "./yield-to-event-loop.js";

const PROJECT_INDEX_MODULE_SOURCES = ["next/og", "@vercel/og", "satori", "remotion"];

interface CollectProjectIndexModuleSourcesInput {
  readonly rootDirectory: string;
  readonly candidateFiles: ReadonlyArray<string>;
  readonly deadlineEpochMs?: number;
}

export const collectProjectIndexModuleSources = async ({
  rootDirectory,
  candidateFiles,
  deadlineEpochMs,
}: CollectProjectIndexModuleSourcesInput): Promise<ReadonlyArray<string>> => {
  const foundModuleSources = new Set<string>();
  let sliceStartedAt = performance.now();

  for (const candidateFile of candidateFiles) {
    if (deadlineEpochMs !== undefined && remainingDeadlineBudgetMs(deadlineEpochMs) === 0) break;
    let sourceBuffer: Buffer;
    try {
      sourceBuffer = fs.readFileSync(
        path.isAbsolute(candidateFile) ? candidateFile : path.resolve(rootDirectory, candidateFile),
      );
    } catch {
      continue;
    }
    if (deadlineEpochMs !== undefined && remainingDeadlineBudgetMs(deadlineEpochMs) === 0) break;
    for (const moduleSource of PROJECT_INDEX_MODULE_SOURCES) {
      if (
        sourceBuffer.includes(`"${moduleSource}"`) ||
        sourceBuffer.includes(`'${moduleSource}'`)
      ) {
        foundModuleSources.add(moduleSource);
      }
    }
    if (foundModuleSources.size === PROJECT_INDEX_MODULE_SOURCES.length) break;
    if (performance.now() - sliceStartedAt >= COOPERATIVE_YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      sliceStartedAt = performance.now();
    }
  }

  return [...foundModuleSources].sort();
};
