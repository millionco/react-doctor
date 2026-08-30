import type { ScanFinding, ScannedFile } from "oxlint-plugin-react-doctor/core";
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
    return null;
  }
  const nativeRuleIds = binding.reactDoctorNativeScanRuleIds();
  if (
    !Array.isArray(nativeRuleIds) ||
    !nativeRuleIds.every((ruleId) => typeof ruleId === "string")
  ) {
    return null;
  }
  const scanReactDoctorFile = binding.scanReactDoctorFile;
  return {
    ruleIds: new Set(nativeRuleIds),
    scanFile: (file, ruleIds) => {
      try {
        return parseScanOutput(
          scanReactDoctorFile(
            JSON.stringify({
              absolutePath: file.absolutePath,
              relativePath: file.relativePath,
              content: file.content,
              isGeneratedBundle: file.isGeneratedBundle,
              ruleIds,
            }),
          ),
          ruleIds,
        );
      } catch {
        return null;
      }
    },
  };
};
