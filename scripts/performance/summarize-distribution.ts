import type { DistributionSummary } from "./types.ts";

const calculateMedian = (sortedValues: ReadonlyArray<number>): number => {
  const upperMiddleIndex = Math.floor(sortedValues.length / 2);
  const upperMiddleValue = sortedValues[upperMiddleIndex];
  if (upperMiddleValue === undefined) {
    throw new Error("Cannot calculate the median of an empty distribution");
  }
  if (sortedValues.length % 2 === 1) return upperMiddleValue;

  const lowerMiddleValue = sortedValues[upperMiddleIndex - 1];
  if (lowerMiddleValue === undefined) {
    throw new Error("Cannot calculate the median of an empty distribution");
  }
  return (lowerMiddleValue + upperMiddleValue) / 2;
};

export const summarizeDistribution = (values: ReadonlyArray<number>): DistributionSummary => {
  if (values.length === 0) {
    throw new Error("Cannot summarize an empty distribution");
  }
  const sortedValues = [...values].sort((firstValue, secondValue) => firstValue - secondValue);
  const medianValue = calculateMedian(sortedValues);
  const minimum = sortedValues[0];
  const maximum = sortedValues[sortedValues.length - 1];
  if (minimum === undefined || maximum === undefined) {
    throw new Error("Cannot summarize an empty distribution");
  }
  const absoluteDeviations = sortedValues
    .map((value) => Math.abs(value - medianValue))
    .sort((firstValue, secondValue) => firstValue - secondValue);
  return {
    minimum,
    median: medianValue,
    maximum,
    medianAbsoluteDeviation: calculateMedian(absoluteDeviations),
  };
};
