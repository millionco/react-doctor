// rule: no-unsafe-json-parse
// weakness: cross-file
// source: local RDE validation (PostHog dataset key helpers)
import { getTrendDatasetKey } from "./insight-utils";

export const getBreakdownValue = (dataset: unknown): unknown => {
  const key = getTrendDatasetKey(dataset);
  return JSON.parse(key).breakdown_value;
};
