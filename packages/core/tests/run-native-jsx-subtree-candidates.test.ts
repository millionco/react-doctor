import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV } from "../src/constants.js";
import {
  detectDuplicateJsxSubtrees,
  detectDuplicateJsxSubtreesCooperative,
  type JsxSubtreeCandidate,
} from "../src/react-cleanup/detect-duplicate-jsx-subtrees.js";
import { runNativeJsxSubtreeCandidates } from "../src/react-cleanup/run-native-jsx-subtree-candidates.js";

const bindingState = vi.hoisted(() => ({
  extract:
    vi.fn<(fileName: string, sourceText: string, maximumCandidateCount: number) => unknown>(),
  load: vi.fn<() => Record<string, unknown> | null>(),
}));

vi.mock("../src/runners/oxlint/load-native-oxlint-binding.js", () => ({
  loadNativeOxlintBinding: bindingState.load,
}));
vi.mock("../src/react-cleanup/run-native-duplicate-jsx-analysis.js", () => ({
  runNativeDuplicateJsxAnalysis: () => null,
}));

const fileName = "src/card.tsx";
const sourceText = "const view = <Card />;";
const candidate: JsxSubtreeCandidate = {
  metadata: { fingerprint: `jsx:${"a".repeat(64)}`, nodeCount: 1, depth: 1 },
  occurrence: {
    path: fileName,
    startOffset: 13,
    endOffset: 21,
    startLine: 1,
    startColumn: 14,
    endLine: 1,
    endColumn: 22,
    rootName: "Card",
    parentRootName: null,
    compositionPath: ["Card"],
    compositionRootStartOffset: null,
  },
};

describe("runNativeJsxSubtreeCandidates", () => {
  beforeEach(() => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "1");
    bindingState.extract.mockReset();
    bindingState.load.mockReset();
    bindingState.load.mockReturnValue({
      extractReactDoctorJsxSubtreeCandidates: bindingState.extract,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("preserves candidate fields and passes paths, source and numeric budget unchanged", () => {
    const result = { candidates: [candidate], limitExceeded: false };
    bindingState.extract.mockReturnValue(JSON.stringify(result));
    expect(runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toEqual(result);
    expect(bindingState.extract).toHaveBeenCalledExactlyOnceWith(fileName, sourceText, 2);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, 1.5])(
    "passes the canonical numeric candidate budget directly: %s",
    (maximumCandidateCount) => {
      bindingState.extract.mockReturnValue('{"candidates":[],"limitExceeded":false}');
      expect(runNativeJsxSubtreeCandidates(fileName, sourceText, maximumCandidateCount)).toEqual({
        candidates: [],
        limitExceeded: false,
      });
      expect(bindingState.extract).toHaveBeenCalledExactlyOnceWith(
        fileName,
        sourceText,
        maximumCandidateCount,
      );
    },
  );

  it("uses accepted candidates without replacing them with canonical extraction", () => {
    bindingState.extract.mockImplementation((path) =>
      JSON.stringify({
        candidates: [{ ...candidate, occurrence: { ...candidate.occurrence, path } }],
        limitExceeded: false,
      }),
    );
    const result = detectDuplicateJsxSubtrees(
      [
        { path: fileName, sourceText },
        { path: "src/second.tsx", sourceText },
      ],
      { minimumNodeCount: 1, minimumDepth: 1, minimumOccurrences: 1 },
    );
    expect(result.scannedSourceFileCount).toBe(2);
    expect(result.scannedJsxNodeCount).toBe(2);
    expect(result.families[0]?.fingerprint).toBe(candidate.metadata.fingerprint);
  });

  it("falls back for the whole file on explicit unsupported output in required mode", () => {
    bindingState.extract.mockReturnValue('{"unsupported":["syntax"]}');
    expect(runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toBeNull();
    expect(detectDuplicateJsxSubtrees([{ path: fileName, sourceText }])).toMatchObject({
      scannedSourceFileCount: 1,
      scannedJsxNodeCount: 1,
      incomplete: false,
    });
  });

  it("maps native node-limit results using existing project counters", () => {
    bindingState.extract.mockImplementation((path, _source, maximumCandidateCount) =>
      JSON.stringify({
        candidates:
          maximumCandidateCount === 0
            ? []
            : [{ ...candidate, occurrence: { ...candidate.occurrence, path } }],
        limitExceeded: maximumCandidateCount === 0,
      }),
    );
    const result = detectDuplicateJsxSubtrees(
      [
        { path: "a.tsx", sourceText },
        { path: "b.tsx", sourceText },
      ],
      { budget: { maxJsxNodes: 1 } },
    );
    expect(bindingState.extract.mock.calls.map((call) => call[2])).toEqual([1, 0]);
    expect(result).toMatchObject({
      scannedSourceFileCount: 1,
      scannedJsxNodeCount: 1,
      incomplete: true,
      incompleteReasons: [{ kind: "jsx-node-limit", limit: 1, observed: 2, path: "b.tsx" }],
    });
  });

  it("keeps length and no-JSX gates before loading a native binding", () => {
    const plain = detectDuplicateJsxSubtrees([{ path: fileName, sourceText: "const count = 1;" }]);
    expect(plain).toMatchObject({
      scannedSourceFileCount: 1,
      scannedJsxNodeCount: 0,
      incomplete: false,
    });
    const oversized = detectDuplicateJsxSubtrees([{ path: fileName, sourceText }], {
      budget: { maxSourceLengthChars: 1 },
    });
    expect(oversized).toMatchObject({ scannedSourceFileCount: 0, incomplete: true });
    expect(bindingState.load).not.toHaveBeenCalled();
  });

  it.each(["\uD800", "\uDC00"])(
    "falls back before passing lone UTF-16 units to NAPI: %s",
    (surrogate) => {
      expect(runNativeJsxSubtreeCandidates(fileName, sourceText + surrogate, 2)).toBeNull();
      expect(runNativeJsxSubtreeCandidates(surrogate + fileName, sourceText, 2)).toBeNull();
      expect(bindingState.extract).not.toHaveBeenCalled();
      expect(
        detectDuplicateJsxSubtrees([{ path: fileName, sourceText: sourceText + surrogate }]),
      ).toMatchObject({
        scannedSourceFileCount: 1,
        scannedJsxNodeCount: 1,
        incomplete: false,
      });
    },
  );

  it("does not inspect UTF-16 well-formedness in the ordinary TypeScript lane", () => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "");
    bindingState.load.mockReturnValue(null);
    const isWellFormed = vi.spyOn(String.prototype, "isWellFormed");
    expect(runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toBeNull();
    expect(isWellFormed).not.toHaveBeenCalled();
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
    '{"unsupported":["reason"],"candidates":[]}',
    '{"candidates":[],"limitExceeded":"false"}',
    '{"candidates":{}}',
    '{"candidates":[],"limitExceeded":false,"extra":true}',
  ])("rejects malformed output in required mode: %s", (output) => {
    bindingState.extract.mockReturnValue(output);
    expect(() => runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toThrow(
      /required native JSX subtree candidate extraction/,
    );
  });

  it.each([
    null,
    {},
    { ...candidate, metadata: { ...candidate.metadata, fingerprint: "invalid" } },
    { ...candidate, metadata: { ...candidate.metadata, nodeCount: 0 } },
    { ...candidate, metadata: { ...candidate.metadata, depth: 2 } },
    { ...candidate, metadata: { ...candidate.metadata, depth: 1.5 } },
    { ...candidate, metadata: { ...candidate.metadata, extra: true } },
    { ...candidate, occurrence: { ...candidate.occurrence, path: "different.tsx" } },
    { ...candidate, occurrence: { ...candidate.occurrence, startOffset: -1 } },
    { ...candidate, occurrence: { ...candidate.occurrence, endOffset: sourceText.length + 1 } },
    { ...candidate, occurrence: { ...candidate.occurrence, endOffset: 13 } },
    { ...candidate, occurrence: { ...candidate.occurrence, startLine: 0 } },
    { ...candidate, occurrence: { ...candidate.occurrence, endLine: 0 } },
    { ...candidate, occurrence: { ...candidate.occurrence, endColumn: 14 } },
    { ...candidate, occurrence: { ...candidate.occurrence, compositionPath: [] } },
    { ...candidate, occurrence: { ...candidate.occurrence, compositionPath: ["Other"] } },
    { ...candidate, occurrence: { ...candidate.occurrence, compositionRootStartOffset: 14 } },
  ])("rejects malformed candidate metadata or spans: %j", (invalidCandidate) => {
    bindingState.extract.mockReturnValue(
      JSON.stringify({ candidates: [candidate, invalidCandidate], limitExceeded: false }),
    );
    expect(() => runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toThrow(
      /invalid candidate/,
    );
  });

  it("rejects partial candidate output on a node-limit result", () => {
    bindingState.extract.mockReturnValue(
      JSON.stringify({ candidates: [candidate], limitExceeded: true }),
    );
    expect(() => runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toThrow(/invalid result/);
  });

  it("preserves native errors as required-mode causes", () => {
    const failure = new Error("native extraction failed");
    bindingState.extract.mockImplementation(() => {
      throw failure;
    });
    expect(() => runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toThrow(
      expect.objectContaining({ cause: failure }),
    );
  });

  it("rejects a missing required export", () => {
    bindingState.load.mockReturnValue({});
    expect(() => runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toThrow(
      /does not provide JSX subtree candidate extraction/,
    );
  });

  it("falls back on optional native failures without keeping partial candidates", () => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "");
    bindingState.extract.mockReturnValue(
      JSON.stringify({ candidates: [candidate, null], limitExceeded: false }),
    );
    expect(runNativeJsxSubtreeCandidates(fileName, sourceText, 2)).toBeNull();
    expect(detectDuplicateJsxSubtrees([{ path: fileName, sourceText }]).scannedJsxNodeCount).toBe(
      1,
    );
  });

  it.each([
    { sourceText, scannedSourceFileCount: 0, incomplete: true },
    {
      sourceText: 'import { createSignal } from "solid-js"; <div />;',
      scannedSourceFileCount: 1,
      incomplete: false,
    },
  ])("preserves canonical abort handling after a source read: %j", async (expected) => {
    const controller = new AbortController();
    const result = await detectDuplicateJsxSubtreesCooperative(
      {
        paths: [fileName],
        read: async () => {
          controller.abort(null);
          return expected.sourceText;
        },
      },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      scannedSourceFileCount: expected.scannedSourceFileCount,
      incomplete: expected.incomplete,
    });
    expect(bindingState.extract).not.toHaveBeenCalled();
  });

  it("does not accept candidates when cancellation occurs during the native call", () => {
    const controller = new AbortController();
    bindingState.extract.mockImplementation(() => {
      controller.abort(null);
      return JSON.stringify({ candidates: [candidate], limitExceeded: false });
    });
    expect(
      detectDuplicateJsxSubtrees([{ path: fileName, sourceText }], { signal: controller.signal }),
    ).toMatchObject({
      scannedSourceFileCount: 0,
      scannedJsxNodeCount: 0,
      incompleteReasons: [{ kind: "aborted", observed: 0 }],
    });
  });
});
