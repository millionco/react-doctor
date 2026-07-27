import { parseSource } from "../internal/parse-source.js";
import type {
  ParseSourceError,
  ParseSourceOptions,
  ParseSourceResult,
} from "../internal/parse-source.js";

interface ParseFixtureOptions extends ParseSourceOptions {}

export interface ParseFixtureError extends ParseSourceError {}

export interface ParseFixtureResult extends ParseSourceResult {}

export const parseFixture = (
  sourceText: string,
  options: ParseFixtureOptions = {},
): ParseFixtureResult => parseSource(sourceText, options);
