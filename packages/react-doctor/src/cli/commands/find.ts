import { stat } from "node:fs/promises";
import * as path from "node:path";
import { isErrnoException } from "@react-doctor/core";
import { searchSymbols } from "@rayhanadev/truffler";
import type { SymbolSearchResult } from "@rayhanadev/truffler";
import { CliInputError } from "../utils/cli-input-error.js";
import { DEFAULT_FIND_LIMIT, DEFAULT_SOURCE_POSITION, METRIC } from "../utils/constants.js";
import { formatFindPath } from "../utils/format-find-path.js";
import { formatFindSymbolResult } from "../utils/format-find-symbol-result.js";
import { parseFindKinds } from "../utils/parse-find-kinds.js";
import { recordCount } from "../utils/record-metric.js";
import { resolveFindSymbolKind } from "../utils/resolve-find-symbol-kind.js";

export interface FindOptions {
  readonly cwd?: string;
  readonly json?: boolean;
  readonly kind?: string;
  readonly limit?: number | string;
}

interface FindJsonResult {
  readonly name: string;
  readonly kind: string;
  readonly symbolKind: SymbolSearchResult["kind"];
  readonly location: FindJsonLocation;
  readonly container?: string;
  readonly signature?: string;
  readonly parameters?: SymbolSearchResult["parameters"];
  readonly returnType?: string;
  readonly score: number;
  readonly matches: ReadonlyArray<number>;
}

interface FindJsonOutput {
  readonly query: string;
  readonly root: string;
  readonly count: number;
  readonly results: ReadonlyArray<FindJsonResult>;
}

interface FindJsonLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

const parseFindLimit = (value: number | string | undefined): number => {
  if (value === undefined) return DEFAULT_FIND_LIMIT;
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    throw new CliInputError(`Invalid limit "${value}". Expected a non-negative integer.`);
  }
  const parsedLimit = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 0) {
    throw new CliInputError(`Invalid limit "${value}". Expected a non-negative integer.`);
  }
  return parsedLimit;
};

const isRequestedFindKind = (
  result: SymbolSearchResult,
  requestedKinds: ReadonlySet<string>,
): boolean => requestedKinds.has(result.kind) || requestedKinds.has(resolveFindSymbolKind(result));

const buildFindJsonOutput = (
  query: string,
  root: string,
  cwd: string,
  results: ReadonlyArray<SymbolSearchResult>,
): FindJsonOutput => ({
  query,
  root,
  count: results.length,
  results: results.map((result) => ({
    name: result.name,
    kind: resolveFindSymbolKind(result),
    symbolKind: result.kind,
    location: {
      file: formatFindPath(result.file, cwd),
      line: result.line ?? DEFAULT_SOURCE_POSITION,
      column: result.column ?? DEFAULT_SOURCE_POSITION,
    },
    container: result.container,
    signature: result.signature,
    parameters: result.parameters,
    returnType: result.returnType,
    score: result.score,
    matches: result.matches,
  })),
});

export const findAction = async (
  query: string,
  directory = ".",
  options: FindOptions = {},
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "find" });
  const displayQuery = query.trim();
  const searchQuery = displayQuery.replace(/[^\p{L}\p{N}_$]+/gu, "");
  if (searchQuery.length === 0) throw new CliInputError("Search query cannot be empty.");

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const rootPath = path.resolve(cwd, directory);
  try {
    await stat(rootPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new CliInputError(`Search path "${directory}" does not exist.`);
    }
    throw error;
  }
  const limit = parseFindLimit(options.limit);
  const parsedKinds = parseFindKinds(options.kind);
  const results = await searchSymbols(searchQuery, {
    root: directory,
    cwd,
    symbolKinds: parsedKinds.symbolKinds,
    ignoreParseErrors: true,
    onParseError: (error) => {
      process.stderr.write(
        `Warning: skipped ${formatFindPath(error.file, cwd)}: ${error.message}\n`,
      );
    },
  });
  const filteredResults = results
    .filter((result) => isRequestedFindKind(result, parsedKinds.requestedKinds))
    .slice(0, limit);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(buildFindJsonOutput(displayQuery, directory, cwd, filteredResults), null, 2)}\n`,
    );
    return;
  }

  if (filteredResults.length === 0) return;
  process.stdout.write(
    `${filteredResults.map((result) => formatFindSymbolResult(result, cwd)).join("\n")}\n`,
  );
};
