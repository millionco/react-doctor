import { BYTES_PER_KIBIBYTE } from "./constants.ts";
import type {
  OxlintOverheadMeasurement,
  OxlintOverheadResult,
  OxlintOverheadShare,
  OxlintOverheadWorkloadResult,
} from "./types.ts";

const formatMilliseconds = (value: number): string => `${value.toFixed(2)} ms`;
const formatPercentage = (value: number): string => `${value.toFixed(1)}%`;

const findMeasurement = (
  workload: OxlintOverheadWorkloadResult,
  measurementId: string,
): OxlintOverheadMeasurement => {
  const measurement = workload.measurements.find(
    (candidateMeasurement) => candidateMeasurement.id === measurementId,
  );
  if (!measurement) {
    throw new Error(`Missing ${measurementId} measurement for ${workload.id} workload`);
  }
  return measurement;
};

const findShare = (
  workload: OxlintOverheadWorkloadResult,
  shareId: string,
): OxlintOverheadShare => {
  const share = workload.shares.find((candidateShare) => candidateShare.id === shareId);
  if (!share) throw new Error(`Missing ${shareId} share for ${workload.id} workload`);
  return share;
};

export const renderOxlintOverheadMarkdown = (result: OxlintOverheadResult): string => {
  const lines = [
    "# Oxlint subprocess overhead",
    "",
    `Generated: ${result.generatedAt}`,
    `Host: ${result.host.cpuModel}, ${result.host.cpuCount} CPUs, Node ${result.host.nodeVersion}, ${result.host.platform}-${result.host.architecture}`,
    `Toolchain: oxlint ${result.toolchain.oxlintVersion}, ${result.toolchain.representativeRule}, one thread`,
    `Workload: ${result.toolchain.representativeCallExpressionCount} call expressions, ${result.toolchain.representativeSourceBytes} bytes`,
    `Samples: ${result.options.samples} measured after ${result.options.warmups} warmups`,
    "",
    "## Direct measurements",
    "",
    "| Operation | Median | MAD | Range | Measurement scope |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const measurement of result.measurements) {
    lines.push(
      `| ${measurement.label} | ${formatMilliseconds(measurement.milliseconds.median)} | ${formatMilliseconds(measurement.milliseconds.medianAbsoluteDeviation)} | ${formatMilliseconds(measurement.milliseconds.minimum)}–${formatMilliseconds(measurement.milliseconds.maximum)} | ${measurement.method} |`,
    );
  }
  lines.push(
    "",
    "## Inferred residuals",
    "",
    "| Residual | Median difference | Calculation |",
    "| --- | ---: | --- |",
  );
  for (const residual of result.residuals) {
    lines.push(
      `| ${residual.label} | ${formatMilliseconds(residual.medianMilliseconds)} | ${residual.calculation} |`,
    );
  }
  lines.push(
    "",
    "## Repository-scale workloads",
    "",
    "| Workload | Shape | Source | Parse only | Plugin, no rules | Representative rule | Startup proxy share | Plugin increment share |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const workload of result.workloads) {
    const parseMeasurement = findMeasurement(workload, "parse-no-rules");
    const pluginMeasurement = findMeasurement(workload, "plugin-no-rules");
    const ruleMeasurement = findMeasurement(workload, "representative-rule");
    const startupShare = findShare(workload, "startup-proxy-share");
    const pluginShare = findShare(workload, "plugin-increment-share");
    lines.push(
      `| ${workload.label} | ${workload.sourceFileCount} files / ${workload.sourceDirectoryCount} directories | ${(workload.sourceByteCount / BYTES_PER_KIBIBYTE).toFixed(1)} KiB | ${formatMilliseconds(parseMeasurement.milliseconds.median)} | ${formatMilliseconds(pluginMeasurement.milliseconds.median)} | ${formatMilliseconds(ruleMeasurement.milliseconds.median)} | ${formatPercentage(startupShare.percentage)} | ${formatPercentage(pluginShare.percentage)} |`,
    );
  }
  lines.push(
    "",
    "Shares use the representative-rule scan median as the denominator. The startup value is an `oxlint --version` proxy; plugin increment is the plugin/no-rule median minus the parse/no-rule median.",
  );
  lines.push("", "## Interpretation limits", "");
  for (const limitation of result.limitations) lines.push(`- ${limitation}`);
  return `${lines.join("\n")}\n`;
};
