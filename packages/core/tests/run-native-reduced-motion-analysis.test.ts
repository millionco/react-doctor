import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { analyzeReducedMotionSource } from "../src/check-reduced-motion.js";
import { REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV } from "../src/constants.js";
import { runNativeReducedMotionAnalysis } from "../src/utils/run-native-reduced-motion-analysis.js";

const bindingState = vi.hoisted(() => ({
  analyze: vi.fn<(inputJson: string) => unknown>(),
  load: vi.fn<() => Record<string, unknown> | null>(),
}));

vi.mock("../src/runners/oxlint/load-native-oxlint-binding.js", () => ({
  loadNativeOxlintBinding: bindingState.load,
}));

const sources = [
  {
    fileName: "motion.tsx",
    sourceText: 'import { motion } from "motion/react"; <motion.div title="😀" />;',
  },
];

describe("runNativeReducedMotionAnalysis", () => {
  beforeEach(() => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "1");
    bindingState.analyze.mockReset();
    bindingState.load.mockReset();
    bindingState.load.mockReturnValue({ analyzeReactDoctorReducedMotion: bindingState.analyze });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("preserves exact evidence, source order and Unicode while resolving paths", () => {
    const evidence = { hasMotionUse: true, hasReducedMotionHandling: false };
    bindingState.analyze.mockReturnValue(JSON.stringify(evidence));
    const orderedSources = [
      ...sources,
      { fileName: "policy.ts", sourceText: 'export const policy = "user";' },
    ];
    expect(runNativeReducedMotionAnalysis(orderedSources)).toEqual(evidence);
    expect(JSON.parse(bindingState.analyze.mock.calls[0][0])).toEqual(
      orderedSources.map(({ fileName, sourceText }) => ({
        fileName: path.resolve(fileName),
        sourceText,
      })),
    );
  });

  it("permits explicit unsupported fallback in required mode", () => {
    bindingState.analyze.mockReturnValue(
      JSON.stringify({ unsupported: ["unsupported source semantics"] }),
    );
    expect(runNativeReducedMotionAnalysis(sources)).toBeNull();
    expect(analyzeReducedMotionSource(sources[0])).toEqual({
      hasMotionUse: true,
      hasReducedMotionHandling: false,
    });
  });

  it.each([
    { hasMotionUse: false, hasReducedMotionHandling: false },
    { hasMotionUse: false, hasReducedMotionHandling: true },
    { hasMotionUse: true, hasReducedMotionHandling: false },
    { hasMotionUse: true, hasReducedMotionHandling: true },
  ])("returns supported evidence without canonical substitution: %j", (evidence) => {
    bindingState.analyze.mockReturnValue(JSON.stringify(evidence));
    expect(analyzeReducedMotionSource(sources[0])).toEqual(evidence);
  });

  it("preserves the canonical prefilter before loading a required binding", () => {
    expect(analyzeReducedMotionSource({ fileName: "plain.tsx", sourceText: "<div />" })).toEqual({
      hasMotionUse: false,
      hasReducedMotionHandling: false,
    });
    expect(bindingState.load).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "not JSON",
    "null",
    "[]",
    "{}",
    '{"unsupported":[]}',
    '{"unsupported":[""]}',
    '{"unsupported":[1]}',
    '{"unsupported":["reason"],"hasMotionUse":false}',
    '{"hasMotionUse":false}',
    '{"hasMotionUse":"false","hasReducedMotionHandling":false}',
    '{"hasMotionUse":false,"hasReducedMotionHandling":false,"extra":true}',
  ])("rejects malformed native output: %s", (output) => {
    bindingState.analyze.mockReturnValue(output);
    expect(() => runNativeReducedMotionAnalysis(sources)).toThrow(
      /required native reduced motion analysis/,
    );
  });

  it("preserves a native failure as the required-mode error cause", () => {
    const failure = new Error("native failed");
    bindingState.analyze.mockImplementation(() => {
      throw failure;
    });
    expect(() => runNativeReducedMotionAnalysis(sources)).toThrow(
      expect.objectContaining({ cause: failure }),
    );
  });

  it("rejects a missing native export in required mode", () => {
    bindingState.load.mockReturnValue({});
    expect(() => runNativeReducedMotionAnalysis(sources)).toThrow(
      /does not provide reduced motion analysis/,
    );
  });

  it("retains canonical operation when an optional binding is absent or fails", () => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "");
    bindingState.load.mockReturnValue(null);
    expect(runNativeReducedMotionAnalysis(sources)).toBeNull();
    bindingState.load.mockReturnValue({ analyzeReactDoctorReducedMotion: bindingState.analyze });
    bindingState.analyze.mockReturnValue("not JSON");
    expect(runNativeReducedMotionAnalysis(sources)).toBeNull();
  });

  it.each(["\uD800", "\uDC00"])(
    "preserves lone UTF-16 units through canonical fallback: %s",
    (surrogate) => {
      expect(
        runNativeReducedMotionAnalysis([
          { ...sources[0], sourceText: sources[0].sourceText + surrogate },
        ]),
      ).toBeNull();
      expect(
        runNativeReducedMotionAnalysis([{ ...sources[0], fileName: surrogate + ".tsx" }]),
      ).toBeNull();
      expect(bindingState.analyze).not.toHaveBeenCalled();
    },
  );
});
