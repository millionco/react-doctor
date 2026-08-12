import { describe, expect, it } from "vite-plus/test";
import { reactDoctorRules } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { MODULE_SCOPE_SNIPPET_POOL } from "../src/snippet-pools.js";

const THREE_CORPUS_SNIPPET_MARKERS = [
  "FuzzThreeCorpusClosedThree",
  "FuzzThreeCorpusDefectThree",
  "FuzzThreeCorpusInterleavedGeometry",
  "FuzzThreeCorpusEnvironmentThree",
  "FuzzThreeCorpusHelperThree",
  "FuzzThreeCorpusDynamicThree",
];

const EXPECTED_FIRING_MARKERS_BY_RULE = {
  "three-require-lit-material-normals": [
    "FuzzThreeCorpusDefectThree",
    "FuzzThreeCorpusDynamicThree",
  ],
  "three-require-uv-for-texture-map": ["FuzzThreeCorpusDefectThree", "FuzzThreeCorpusDynamicThree"],
  "three-require-environment-for-metal": ["FuzzThreeCorpusDefectThree"],
  "three-require-lighting-for-pbr": ["FuzzThreeCorpusDefectThree"],
};

describe("harvested Three.js corpus snippets", () => {
  it("parses every snippet and preserves its diagnostic matrix", () => {
    const snippets = THREE_CORPUS_SNIPPET_MARKERS.map((marker) => ({
      marker,
      source: MODULE_SCOPE_SNIPPET_POOL.find((snippet) => snippet.includes(marker)),
    }));
    expect(snippets.filter((snippet) => snippet.source === undefined)).toEqual([]);

    for (const [ruleId, expectedFiringMarkers] of Object.entries(EXPECTED_FIRING_MARKERS_BY_RULE)) {
      const entry = reactDoctorRules.find((candidate) => candidate.id === ruleId);
      expect(entry).toBeDefined();
      if (!entry) continue;

      for (const snippet of snippets) {
        if (!snippet.source) continue;
        const result = runRule(entry.rule, snippet.source, {
          filename: `${snippet.marker}.ts`,
        });
        expect(result.parseErrors).toEqual([]);
        const expectedDiagnosticCount = expectedFiringMarkers.includes(snippet.marker) ? 1 : 0;
        expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
      }
    }
  });
});
