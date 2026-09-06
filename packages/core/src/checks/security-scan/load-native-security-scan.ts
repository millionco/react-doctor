import type { ScanFinding, ScannedFile } from "oxlint-plugin-react-doctor/core";
import { NATIVE_REACT_DOCTOR_SCAN_RULE_IDS } from "../../constants.js";
import { handleNativeOxlintFailure } from "../../runners/oxlint/handle-native-oxlint-failure.js";
import { loadNativeOxlintBinding } from "../../runners/oxlint/load-native-oxlint-binding.js";
import { isRecord } from "../../utils/is-record.js";

export interface NativeSecurityScan {
  readonly ruleIds: ReadonlySet<string>;
  readonly scanFile: (
    file: ScannedFile,
    ruleIds: ReadonlyArray<string>,
  ) => ReadonlyMap<string, ReadonlyArray<ScanFinding>> | null;
}

const isScanFinding = (value: unknown): value is ScanFinding =>
  isRecord(value) &&
  typeof value.message === "string" &&
  typeof value.line === "number" &&
  typeof value.column === "number" &&
  (value.severity === undefined || value.severity === "error" || value.severity === "warn") &&
  (value.title === undefined || typeof value.title === "string") &&
  (value.help === undefined || typeof value.help === "string");

const parseScanOutput = (
  outputJson: unknown,
  ruleIds: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<ScanFinding>> | null => {
  if (typeof outputJson !== "string") return null;
  let output: unknown;
  try {
    output = JSON.parse(outputJson);
  } catch {
    return null;
  }
  if (!isRecord(output)) return null;
  const findingsByRule = new Map<string, ReadonlyArray<ScanFinding>>();
  for (const ruleId of ruleIds) {
    const findings = output[ruleId];
    if (!Array.isArray(findings) || !findings.every(isScanFinding)) return null;
    findingsByRule.set(ruleId, findings);
  }
  return findingsByRule;
};

export const loadNativeSecurityScan = (): NativeSecurityScan | null => {
  const binding = loadNativeOxlintBinding();
  if (
    binding === null ||
    typeof binding.reactDoctorNativeScanRuleIds !== "function" ||
    typeof binding.scanReactDoctorFile !== "function"
  ) {
    handleNativeOxlintFailure(
      "The required native Oxlint binding does not provide the security scan APIs.",
    );
    return null;
  }
  const nativeRuleIds = binding.reactDoctorNativeScanRuleIds();
  if (
    !Array.isArray(nativeRuleIds) ||
    !nativeRuleIds.every((ruleId) => typeof ruleId === "string")
  ) {
    handleNativeOxlintFailure(
      "The required native Oxlint binding returned invalid security scan rule ids.",
    );
    return null;
  }
  const nativeRuleIdSet = new Set(nativeRuleIds);
  const missingNativeRuleIds = [...NATIVE_REACT_DOCTOR_SCAN_RULE_IDS].filter(
    (ruleId) => !nativeRuleIdSet.has(ruleId),
  );
  if (missingNativeRuleIds.length > 0) {
    handleNativeOxlintFailure(
      `The required native security scan does not advertise supported rules: ${missingNativeRuleIds.join(", ")}.`,
    );
  }
  const scanReactDoctorFile = binding.scanReactDoctorFile;
  const scanReactDoctorFileSource =
    typeof binding.scanReactDoctorFileSource === "function"
      ? binding.scanReactDoctorFileSource
      : null;
  return {
    ruleIds: nativeRuleIdSet,
    scanFile: (file, ruleIds) => {
      let outputJson: unknown;
      try {
        const canUseSourceArguments =
          scanReactDoctorFileSource !== null &&
          file.content.isWellFormed() &&
          file.absolutePath.isWellFormed() &&
          file.relativePath.isWellFormed() &&
          ruleIds.every((ruleId) => ruleId.isWellFormed());
        if (canUseSourceArguments) {
          outputJson = scanReactDoctorFileSource(
            file.absolutePath,
            file.relativePath,
            file.content,
            file.isGeneratedBundle,
            ruleIds,
          );
        } else {
          outputJson = scanReactDoctorFile(
            JSON.stringify({
              absolutePath: file.absolutePath,
              relativePath: file.relativePath,
              content: file.content,
              isGeneratedBundle: file.isGeneratedBundle,
              ruleIds,
            }),
          );
        }
      } catch (error) {
        handleNativeOxlintFailure("The required native security scan failed.", error);
        return null;
      }
      const findingsByRule = parseScanOutput(outputJson, ruleIds);
      if (findingsByRule === null) {
        handleNativeOxlintFailure("The required native security scan returned an invalid result.");
        return null;
      }
      return findingsByRule;
    },
  };
};
