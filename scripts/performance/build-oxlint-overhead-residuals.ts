import type { OxlintOverheadMeasurement, OxlintOverheadResidual } from "./types.ts";

export const buildOxlintOverheadResiduals = (
  measurements: ReadonlyArray<OxlintOverheadMeasurement>,
): OxlintOverheadResidual[] => {
  const medianById = new Map(
    measurements.map((measurement) => [measurement.id, measurement.milliseconds.median]),
  );
  const subtract = (leftId: string, rightId: string): number => {
    const left = medianById.get(leftId);
    const right = medianById.get(rightId);
    if (left === undefined || right === undefined) {
      throw new Error(`Missing overhead measurement for ${leftId} - ${rightId}`);
    }
    return left - right;
  };
  return [
    {
      id: "oxlint-after-node",
      label: "Oxlint CLI/native startup beyond bare Node",
      calculation: "oxlint-startup median - node-startup median",
      classification: "inferred",
      medianMilliseconds: subtract("oxlint-startup", "node-startup"),
    },
    {
      id: "parse-no-rules-after-startup",
      label: "Single-file no-rule scan beyond oxlint startup",
      calculation: "parse-no-rules median - oxlint-startup median",
      classification: "inferred",
      medianMilliseconds: subtract("parse-no-rules", "oxlint-startup"),
    },
    {
      id: "plugin-bridge-and-load",
      label: "Oxlint JS-plugin bridge and plugin load",
      calculation: "plugin-no-rules median - parse-no-rules median",
      classification: "inferred",
      medianMilliseconds: subtract("plugin-no-rules", "parse-no-rules"),
    },
    {
      id: "representative-rule-after-plugin",
      label: "Representative rule beyond plugin/no-rule scan",
      calculation: "representative-rule median - plugin-no-rules median",
      classification: "inferred",
      medianMilliseconds: subtract("representative-rule", "plugin-no-rules"),
    },
  ];
};
