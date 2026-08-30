import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  JsxSubtreeCandidate,
  ResolvedJsxDuplicationOptions,
} from "../src/react-cleanup/detect-duplicate-jsx-subtrees.js";
import { runNativeDuplicateJsxAnalysis } from "../src/react-cleanup/run-native-duplicate-jsx-analysis.js";

const bindingState = vi.hoisted(() => ({
  analyze: vi.fn<(inputJson: string) => unknown>(),
}));

vi.mock("../src/runners/oxlint/load-native-oxlint-binding.js", () => ({
  loadNativeOxlintBinding: () => ({
    analyzeReactDoctorDuplicateJsx: bindingState.analyze,
  }),
}));

const options: ResolvedJsxDuplicationOptions = {
  minimumNodeCount: 6,
  minimumDepth: 3,
  minimumOccurrences: 2,
  minimumDistinctFiles: 1,
  maxSourceFiles: 5_000,
  maxSourceLengthChars: 1_000_000,
  maxJsxNodes: 50_000,
  maxFamilies: 20,
};

const candidate = (
  path: string,
  fingerprint: string,
  startOffset: number,
): JsxSubtreeCandidate => ({
  metadata: { fingerprint, nodeCount: 7, depth: 3 },
  occurrence: {
    path,
    startOffset,
    endOffset: startOffset + 20,
    startLine: 1,
    startColumn: 1,
    endLine: 3,
    endColumn: 2,
    rootName: "section",
    parentRootName: null,
    compositionPath: ["Card", "section"],
    compositionRootStartOffset: startOffset,
  },
});

describe("runNativeDuplicateJsxAnalysis", () => {
  beforeEach(() => bindingState.analyze.mockReset());

  it("preserves the native family and sends locale ordering indexes", () => {
    const primaryOccurrence = candidate("src/a.tsx", "fingerprint-a", 10).occurrence;
    const relatedOccurrence = candidate("src/b.tsx", "fingerprint-a", 20).occurrence;
    bindingState.analyze.mockReturnValue(
      JSON.stringify([
        {
          fingerprint: "fingerprint-a",
          nodeCount: 7,
          depth: 3,
          occurrenceCount: 2,
          distinctFileCount: 2,
          estimatedRemovableNodeCount: 7,
          estimatedRemovableLineCount: 3,
          primaryOccurrence,
          relatedOccurrences: [relatedOccurrence],
        },
      ]),
    );

    expect(
      runNativeDuplicateJsxAnalysis(
        [candidate("src/b.tsx", "fingerprint-b", 20), candidate("src/a.tsx", "fingerprint-a", 10)],
        options,
      ),
    ).toEqual([
      {
        fingerprint: "fingerprint-a",
        nodeCount: 7,
        depth: 3,
        occurrenceCount: 2,
        distinctFileCount: 2,
        estimatedRemovableNodeCount: 7,
        estimatedRemovableLineCount: 3,
        primaryOccurrence,
        relatedOccurrences: [relatedOccurrence],
      },
    ]);
    const input = JSON.parse(bindingState.analyze.mock.calls[0][0]);
    expect(input.candidates).toMatchObject([
      {
        fingerprint: "fingerprint-b",
        fingerprintSortIndex: 1,
        occurrence: { path: "src/b.tsx", pathSortIndex: 1 },
      },
      {
        fingerprint: "fingerprint-a",
        fingerprintSortIndex: 0,
        occurrence: { path: "src/a.tsx", pathSortIndex: 0 },
      },
    ]);
  });

  it("falls back when native output is invalid", () => {
    bindingState.analyze.mockReturnValue(JSON.stringify([{ fingerprint: "incomplete" }]));

    expect(runNativeDuplicateJsxAnalysis([], options)).toBeNull();
  });
});
