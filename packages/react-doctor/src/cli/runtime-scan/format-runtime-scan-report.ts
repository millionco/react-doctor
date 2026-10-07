import { highlighter } from "@react-doctor/core";
import { RUNTIME_SCAN_DURATION_PRECISION_DIGITS } from "./constants.js";
import { sanitizeRuntimeText } from "./sanitize-runtime-text.js";
import type { RuntimeScanJsonlRecord, RuntimeScanReport } from "./types.js";

const formatMilliseconds = (durationMs: number): string =>
  `${durationMs.toFixed(RUNTIME_SCAN_DURATION_PRECISION_DIGITS)}ms`;

const formatTextReport = (report: RuntimeScanReport): string => {
  const lines = [
    `${highlighter.success("✔")} Runtime trace captured`,
    highlighter.dim(`  ${sanitizeRuntimeText(report.finalUrl)}`),
    "",
    `${highlighter.info("Trace")} ${sanitizeRuntimeText(report.tracePath)}`,
    `${highlighter.info("Browser")} ${report.connection === "cdp" ? "attached over CDP" : "isolated profile"} · ${formatMilliseconds(report.summary.durationMs)} captured`,
    `${highlighter.info("React")} ${
      report.support.reactDetected
        ? `${sanitizeRuntimeText(report.support.reactVersion ?? "unknown")} (${sanitizeRuntimeText(report.support.reactBuildType ?? "unknown")})`
        : "not detected"
    }`,
    "",
    highlighter.info("Performance"),
    `  ├─ ${report.summary.longAnimationFrameCount} long animation frame${
      report.summary.longAnimationFrameCount === 1 ? "" : "s"
    }; worst ${formatMilliseconds(report.summary.worstFrameDurationMs)}`,
    `  ├─ ${formatMilliseconds(report.summary.totalBlockingDurationMs)} total blocking time`,
    `  ├─ ${report.summary.interactionCount} interaction${
      report.summary.interactionCount === 1 ? "" : "s"
    }; worst ${formatMilliseconds(report.summary.worstInteractionDurationMs)}`,
    `  ├─ CLS ${report.summary.cumulativeLayoutShift.toFixed(
      RUNTIME_SCAN_DURATION_PRECISION_DIGITS,
    )}`,
    `  └─ LCP ${
      report.summary.largestContentfulPaintMs === null
        ? "unavailable"
        : formatMilliseconds(report.summary.largestContentfulPaintMs)
    }`,
  ];

  if (report.scriptHotspots.length > 0) {
    lines.push("", highlighter.info("Script hotspots"));
    for (const [index, hotspot] of report.scriptHotspots.entries()) {
      const prefix = index === report.scriptHotspots.length - 1 ? "└─" : "├─";
      const sourceLocation =
        hotspot.sourceCharPosition > 0
          ? `${sanitizeRuntimeText(hotspot.sourceUrl)} @ char ${hotspot.sourceCharPosition}`
          : sanitizeRuntimeText(hotspot.sourceUrl);
      const location = sourceLocation
        ? `${sourceLocation}${
            hotspot.functionName ? ` · ${sanitizeRuntimeText(hotspot.functionName)}` : ""
          }`
        : sanitizeRuntimeText(hotspot.functionName);
      lines.push(
        `  ${prefix} ${formatMilliseconds(hotspot.totalDurationMs)} ${location}`,
        `     ${hotspot.frameCount} frame${
          hotspot.frameCount === 1 ? "" : "s"
        }, ${formatMilliseconds(hotspot.forcedStyleAndLayoutDurationMs)} forced layout`,
      );
    }
  }

  if (report.componentHotspots.length > 0) {
    lines.push("", highlighter.info("React component hotspots"));
    for (const [index, hotspot] of report.componentHotspots.entries()) {
      const prefix = index === report.componentHotspots.length - 1 ? "└─" : "├─";
      lines.push(
        `  ${prefix} ${sanitizeRuntimeText(hotspot.name)} · ${formatMilliseconds(
          hotspot.totalDurationMs,
        )} across ${hotspot.renderCount} render${hotspot.renderCount === 1 ? "" : "s"}`,
      );
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", highlighter.warn("Limitations"));
    for (const warning of report.warnings) {
      lines.push(`  - ${sanitizeRuntimeText(warning)}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

const formatJsonlReport = (report: RuntimeScanReport): string => {
  const records: RuntimeScanJsonlRecord[] = [
    {
      schemaVersion: report.schemaVersion,
      kind: "metadata",
      data: {
        requestedUrl: report.requestedUrl,
        finalUrl: report.finalUrl,
        tracePath: report.tracePath,
        capturedAt: report.capturedAt,
        timeOrigin: report.timeOrigin,
        connection: report.connection,
        support: report.support,
        warnings: report.warnings,
      },
    },
    { schemaVersion: report.schemaVersion, kind: "summary", data: report.summary },
    ...report.scriptHotspots.map(
      (scriptHotspot): RuntimeScanJsonlRecord => ({
        schemaVersion: report.schemaVersion,
        kind: "script-hotspot",
        data: scriptHotspot,
      }),
    ),
    ...report.componentHotspots.map(
      (componentHotspot): RuntimeScanJsonlRecord => ({
        schemaVersion: report.schemaVersion,
        kind: "component-hotspot",
        data: componentHotspot,
      }),
    ),
    ...report.longAnimationFrames.map(
      (longAnimationFrame): RuntimeScanJsonlRecord => ({
        schemaVersion: report.schemaVersion,
        kind: "long-animation-frame",
        data: longAnimationFrame,
      }),
    ),
    ...report.interactions.map(
      (interaction): RuntimeScanJsonlRecord => ({
        schemaVersion: report.schemaVersion,
        kind: "interaction",
        data: interaction,
      }),
    ),
  ];
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
};

export const formatRuntimeScanReport = (
  report: RuntimeScanReport,
  format: "text" | "json" | "jsonl",
): string => {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "jsonl") return formatJsonlReport(report);
  return formatTextReport(report);
};
