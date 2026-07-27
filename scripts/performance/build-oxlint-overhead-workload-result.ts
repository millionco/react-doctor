import { PERCENT_MULTIPLIER } from "./constants.ts";
import type {
  OxlintOverheadMeasurement,
  OxlintOverheadResidual,
  OxlintOverheadShare,
  OxlintOverheadWorkloadMetadata,
  OxlintOverheadWorkloadResult,
} from "./types.ts";

const findMeasurementMedian = (
  measurements: ReadonlyArray<OxlintOverheadMeasurement>,
  measurementId: string,
): number => {
  const measurement = measurements.find(
    (candidateMeasurement) => candidateMeasurement.id === measurementId,
  );
  if (!measurement) throw new Error(`Missing workload measurement for ${measurementId}`);
  return measurement.milliseconds.median;
};

export const buildOxlintOverheadWorkloadResult = (
  metadata: OxlintOverheadWorkloadMetadata,
  measurements: ReadonlyArray<OxlintOverheadMeasurement>,
  oxlintStartupMedianMilliseconds: number,
): OxlintOverheadWorkloadResult => {
  const parseOnlyMedianMilliseconds = findMeasurementMedian(measurements, "parse-no-rules");
  const pluginNoRulesMedianMilliseconds = findMeasurementMedian(measurements, "plugin-no-rules");
  const representativeRuleMedianMilliseconds = findMeasurementMedian(
    measurements,
    "representative-rule",
  );
  if (representativeRuleMedianMilliseconds <= 0) {
    throw new Error("Representative workload median must be greater than zero");
  }
  const pluginIncrementMilliseconds = pluginNoRulesMedianMilliseconds - parseOnlyMedianMilliseconds;
  const representativeRuleIncrementMilliseconds =
    representativeRuleMedianMilliseconds - pluginNoRulesMedianMilliseconds;
  const residuals: OxlintOverheadResidual[] = [
    {
      id: "plugin-after-parse",
      label: "Plugin-enabled no-rule scan beyond parse-only scan",
      calculation: "plugin-no-rules median - parse-no-rules median",
      classification: "inferred",
      medianMilliseconds: pluginIncrementMilliseconds,
    },
    {
      id: "rule-after-plugin",
      label: "Representative rule scan beyond plugin-enabled no-rule scan",
      calculation: "representative-rule median - plugin-no-rules median",
      classification: "inferred",
      medianMilliseconds: representativeRuleIncrementMilliseconds,
    },
  ];
  const buildShare = (
    id: string,
    label: string,
    calculation: string,
    numeratorMilliseconds: number,
  ): OxlintOverheadShare => ({
    id,
    label,
    calculation,
    classification: "inferred",
    numeratorMilliseconds,
    denominatorMilliseconds: representativeRuleMedianMilliseconds,
    percentage: (numeratorMilliseconds / representativeRuleMedianMilliseconds) * PERCENT_MULTIPLIER,
  });
  return {
    ...metadata,
    measurements,
    residuals,
    shares: [
      buildShare(
        "startup-proxy-share",
        "Oxlint --version startup proxy share",
        "oxlint-startup median / representative-rule median",
        oxlintStartupMedianMilliseconds,
      ),
      buildShare(
        "plugin-increment-share",
        "Plugin registration increment share",
        "(plugin-no-rules median - parse-no-rules median) / representative-rule median",
        pluginIncrementMilliseconds,
      ),
      buildShare(
        "rule-increment-share",
        "Representative rule increment share",
        "(representative-rule median - plugin-no-rules median) / representative-rule median",
        representativeRuleIncrementMilliseconds,
      ),
    ],
  };
};
