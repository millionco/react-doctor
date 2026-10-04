import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ClassificationCandidate, RuleContract } from "../src/classification-schema.js";
import { evaluateWithJev } from "../src/jev-classifier.js";
import { loadClassificationRules } from "../src/load-classification-rules.js";
import { EVALUATION_CONFIG_CONTRACT } from "../src/constants.js";

const { evaluate } = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("ai", () => ({ experimental_evaluate: evaluate }));

const candidate: ClassificationCandidate = {
  schemaVersion: 1,
  repository: { org: "owner", name: "repo", ref: "a".repeat(40), rootDir: "." },
  detectorCommit: "b".repeat(40),
  ruleSetHash: "c".repeat(64),
  rule: {
    key: "react-doctor/jsx-no-duplicate-props",
    description: "No duplicate JSX attribute names.",
    exceptions: ["Names are case sensitive."],
  },
  filePath: "src/app.tsx",
  line: 1,
  detected: true,
  framework: "vite",
  code: 'export const App = () => <div id="a" id="b" />;',
  contextComplete: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("evaluateWithJev", () => {
  it("asks typed questions without revealing the detector's verdict", async () => {
    evaluate.mockResolvedValue({
      answers: {
        assessment: {
          choice: "violation",
          probabilities: { violation: 0.95, valid: 0.04, insufficient_context: 0.01 },
        },
        contextSufficient: { probability: 0.98 },
      },
      usage: { inputTokens: 42 },
    });
    await expect(evaluateWithJev(candidate)).resolves.toMatchObject({
      choice: "violation",
      contextSufficient: 0.98,
      inputTokens: 42,
    });
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ modelId: "typesafe-ai/jev" }),
        state: expect.not.objectContaining({ detected: expect.anything() }),
        questions: {
          assessment: expect.objectContaining({ type: "choice" }),
          contextSufficient: expect.objectContaining({ type: "boolean" }),
        },
        maxRetries: 2,
        abortSignal: expect.any(AbortSignal),
        providerOptions: { gateway: { zeroDataRetention: true } },
      }),
    );
  });

  it("rejects missing choice probabilities", async () => {
    evaluate.mockResolvedValue({
      answers: {
        assessment: { choice: "violation" },
        contextSufficient: { probability: 0.98 },
      },
      usage: {},
    });
    await expect(evaluateWithJev(candidate)).rejects.toThrow();
  });
});

describe("loadClassificationRules", () => {
  const record = {
    evaluation: {
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorCommit: candidate.detectorCommit,
      configContract: EVALUATION_CONFIG_CONTRACT,
      ruleSetHash: candidate.ruleSetHash,
      ruleKeys: [candidate.rule.key],
    },
  };
  const catalog = [
    {
      key: candidate.rule.key,
      rule: {
        title: "Duplicate props",
        recommendation: "Remove duplicate props.",
        framework: "global",
        requires: ["react"],
        isScanRule: false,
      },
    },
    { key: "react-doctor/other", rule: { title: "Other", framework: "global", isScanRule: false } },
    { key: "react-doctor/scan", rule: { title: "Scan", framework: "global", isScanRule: true } },
  ];

  it("loads the pinned catalog once and respects each evaluation's scope", async () => {
    const fetchCatalog = vi.fn(async () => Response.json(catalog));
    vi.stubGlobal("fetch", fetchCatalog);
    const cache = new Map<string, RuleContract[]>();
    const rules = await loadClassificationRules(record, cache);
    expect(rules).toHaveLength(1);
    expect(rules[0].description).toContain("Remove duplicate props.");
    expect(rules[0].description).toContain('"requires":["react"]');
    expect(fetchCatalog).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/millionco/react-doctor/${candidate.detectorCommit}/packages/oxlint-plugin-react-doctor/src/plugin/core-rule-registry-data.json`,
      expect.anything(),
    );
    const unscoped = { evaluation: { ...record.evaluation, ruleKeys: [] } };
    expect(await loadClassificationRules(unscoped, cache)).toHaveLength(2);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("rejects non-GitHub repositories and unavailable catalogs", async () => {
    const fetchCatalog = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchCatalog);
    await expect(
      loadClassificationRules(
        {
          evaluation: {
            ...record.evaluation,
            reactDoctorRepository: "https://example.com/org/repo",
          },
        },
        new Map(),
      ),
    ).rejects.toThrow("use --rules");
    expect(fetchCatalog).not.toHaveBeenCalled();
    await expect(loadClassificationRules(record, new Map())).rejects.toThrow("404");
  });
});
