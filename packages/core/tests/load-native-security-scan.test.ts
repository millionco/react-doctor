import type { ScannedFile } from "oxlint-plugin-react-doctor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { loadNativeSecurityScan } from "../src/checks/security-scan/load-native-security-scan.js";
import {
  NATIVE_REACT_DOCTOR_SCAN_RULE_IDS,
  REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV,
} from "../src/constants.js";

const bindingState = vi.hoisted(() => {
  const sourceExport: unknown = undefined;
  return {
    legacy: vi.fn<(inputJson: string) => unknown>(),
    source: vi.fn<(...argumentsList: unknown[]) => unknown>(),
    sourceExport,
  };
});

vi.mock("../src/runners/oxlint/load-native-oxlint-binding.js", () => ({
  loadNativeOxlintBinding: () => ({
    reactDoctorNativeScanRuleIds: () => [...NATIVE_REACT_DOCTOR_SCAN_RULE_IDS],
    scanReactDoctorFile: bindingState.legacy,
    scanReactDoctorFileSource: bindingState.sourceExport,
  }),
}));

const scannedFile: ScannedFile = {
  absolutePath: "/project/máth/🙂.ts",
  relativePath: "máth/🙂.ts",
  content: 'const value = "🙂e\u0301\uFEFF\0";\r\n',
  isGeneratedBundle: false,
};
const ruleIds = ["postmessage-origin-risk", "insecure-crypto-risk"];
const findings = {
  "postmessage-origin-risk": [],
  "insecure-crypto-risk": [{ message: "signature mismatch", line: 1, column: 2 }],
};

describe("loadNativeSecurityScan", () => {
  beforeEach(() => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "");
    bindingState.legacy.mockReset().mockReturnValue(JSON.stringify(findings));
    bindingState.source.mockReset().mockReturnValue(JSON.stringify(findings));
    bindingState.sourceExport = bindingState.source;
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([false, true])(
    "passes source arguments unchanged with generated=%s",
    (isGeneratedBundle) => {
      const file = { ...scannedFile, isGeneratedBundle };
      expect(loadNativeSecurityScan()?.scanFile(file, ruleIds)).toEqual(
        new Map(Object.entries(findings)),
      );
      expect(bindingState.source).toHaveBeenCalledExactlyOnceWith(
        file.absolutePath,
        file.relativePath,
        file.content,
        isGeneratedBundle,
        ruleIds,
      );
      expect(bindingState.legacy).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, false])(
    "supports legacy bindings with source export %s",
    (sourceExport) => {
      bindingState.sourceExport = sourceExport;
      expect(loadNativeSecurityScan()?.scanFile(scannedFile, ruleIds)).toEqual(
        new Map(Object.entries(findings)),
      );
      expect(bindingState.legacy).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ ...scannedFile, ruleIds }),
      );
      expect(bindingState.source).not.toHaveBeenCalled();
    },
  );

  for (const field of ["absolutePath", "relativePath", "content", "ruleId"]) {
    it.each(["\uD800", "\uDC00"])(
      `preserves legacy decoding for unpaired surrogates in ${field}: %s`,
      (surrogate) => {
        const file = field === "ruleId" ? scannedFile : { ...scannedFile, [field]: surrogate };
        const requestedRuleIds = field === "ruleId" ? [surrogate] : ruleIds;
        bindingState.legacy.mockImplementation(() => {
          throw new Error("invalid unicode escape");
        });
        vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "1");
        expect(() => loadNativeSecurityScan()?.scanFile(file, requestedRuleIds)).toThrow(
          "The required native security scan failed.",
        );
        expect(bindingState.legacy).toHaveBeenCalledExactlyOnceWith(
          JSON.stringify({ ...file, ruleIds: requestedRuleIds }),
        );
        expect(bindingState.source).not.toHaveBeenCalled();
      },
    );
  }

  for (const required of [false, true]) {
    it.each(["not json", "{}", JSON.stringify({ ...findings, "insecure-crypto-risk": [{}] })])(
      `handles invalid source output with required=${required}: %s`,
      (output) => {
        vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, required ? "1" : "");
        bindingState.source.mockReturnValue(output);
        const scan = () => loadNativeSecurityScan()?.scanFile(scannedFile, ruleIds);
        if (required)
          expect(scan).toThrow("The required native security scan returned an invalid result.");
        else expect(scan()).toBeNull();
        expect(bindingState.legacy).not.toHaveBeenCalled();
      },
    );

    it(`handles source exceptions with required=${required}`, () => {
      vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, required ? "1" : "");
      bindingState.source.mockImplementation(() => {
        throw new Error("native scan failure");
      });
      const scan = () => loadNativeSecurityScan()?.scanFile(scannedFile, ruleIds);
      if (required) expect(scan).toThrow("The required native security scan failed.");
      else expect(scan()).toBeNull();
      expect(bindingState.legacy).not.toHaveBeenCalled();
    });
  }
});
