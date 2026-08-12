import { max, median, medianAbsoluteDeviation, min } from "simple-statistics";
import type { DistributionSummary } from "./types.ts";

export const summarizeDistribution = (values: number[]): DistributionSummary => {
  if (values.length === 0) {
    throw new Error("Cannot summarize an empty distribution");
  }
  const medianValue = median(values);
  return {
    minimum: min(values),
    median: medianValue,
    maximum: max(values),
    medianAbsoluteDeviation: medianAbsoluteDeviation(values),
  };
};
