import type { SymbolSearchResult } from "@rayhanadev/truffler";
import { DEFAULT_SOURCE_POSITION } from "./constants.js";
import { formatFindPath } from "./format-find-path.js";
import { resolveFindSymbolKind } from "./resolve-find-symbol-kind.js";

export const formatFindSymbolResult = (result: SymbolSearchResult, cwd: string): string => {
  const displayPath = formatFindPath(result.file, cwd);
  const location = `${displayPath}:${result.line ?? DEFAULT_SOURCE_POSITION}:${result.column ?? DEFAULT_SOURCE_POSITION}`;
  const declaration = result.signature ?? result.snippet ?? result.name;
  return `${location}  ${resolveFindSymbolKind(result)}  ${declaration}`;
};
