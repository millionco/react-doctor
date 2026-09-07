import * as path from "node:path";
import type {
  AnalyzeReducedMotionSourceInput,
  ProjectMotionEvidence,
} from "../check-reduced-motion.js";
import { handleNativeOxlintFailure } from "../runners/oxlint/handle-native-oxlint-failure.js";
import { loadNativeOxlintBinding } from "../runners/oxlint/load-native-oxlint-binding.js";
import { isRecord } from "./is-record.js";

export const runNativeReducedMotionAnalysis = (
  sources: ReadonlyArray<AnalyzeReducedMotionSourceInput>,
): ProjectMotionEvidence | null => {
  const binding = loadNativeOxlintBinding();
  if (binding === null) return null;
  if (typeof binding.analyzeReactDoctorReducedMotion !== "function") {
    handleNativeOxlintFailure(
      "The required native Oxlint binding does not provide reduced motion analysis.",
    );
    return null;
  }
  if (
    sources.some(
      ({ fileName, sourceText }) => !fileName.isWellFormed() || !sourceText.isWellFormed(),
    )
  ) {
    return null;
  }
  const normalizedSources = sources.map(({ fileName, sourceText }) => ({
    fileName: path.resolve(fileName),
    sourceText,
  }));
  if (normalizedSources.some(({ fileName }) => !fileName.isWellFormed())) return null;
  let output: unknown;
  try {
    const outputJson: unknown = binding.analyzeReactDoctorReducedMotion(
      JSON.stringify(normalizedSources),
    );
    if (typeof outputJson !== "string") {
      throw new Error("Native reduced motion output must be a JSON string.");
    }
    output = JSON.parse(outputJson);
  } catch (error) {
    handleNativeOxlintFailure("The required native reduced motion analysis failed.", error);
    return null;
  }
  if (isRecord(output)) {
    if (
      Object.keys(output).every((name) => name === "unsupported") &&
      Array.isArray(output.unsupported) &&
      output.unsupported.length > 0 &&
      output.unsupported.every((reason) => typeof reason === "string" && reason.length > 0)
    ) {
      return null;
    }
    if (
      Object.keys(output).every(
        (name) => name === "hasMotionUse" || name === "hasReducedMotionHandling",
      ) &&
      typeof output.hasMotionUse === "boolean" &&
      typeof output.hasReducedMotionHandling === "boolean"
    ) {
      return {
        hasMotionUse: output.hasMotionUse,
        hasReducedMotionHandling: output.hasReducedMotionHandling,
      };
    }
  }
  handleNativeOxlintFailure(
    "The required native reduced motion analysis returned an invalid result.",
  );
  return null;
};
