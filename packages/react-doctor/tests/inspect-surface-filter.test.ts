import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { filterDiagnosticsForSurface } from "@react-doctor/core";
import type { ReactDoctorConfig } from "@react-doctor/core";
import { inspect } from "../src/inspect.js";
import { computeProjectedScore } from "../src/cli/utils/compute-score-projection.js";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import { setupReactProject } from "./regressions/_helpers.js";

vi.mock("../src/cli/utils/compute-score-projection.js", () => ({
  computeProjectedScore: vi.fn(async () => null),
}));

const mockedComputeProjectedScore = vi.mocked(computeProjectedScore);

vi.mock("ora", () => ({
  default: () => ({
    text: "",
    start: function () {
      return this;
    },
    stop: function () {
      return this;
    },
    succeed: () => {},
    fail: () => {},
  }),
}));

const FIXTURES_DIRECTORY = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "core",
  "tests",
  "fixtures",
);

// The `design`-tagged rules ship `defaultEnabled: false`, so the surface
// filter has nothing to act on unless we opt them back in. Enable a few
// inline-style design rules that fire on `basic-react/src/design-issues.tsx`
// (no Tailwind capability required) so these surface-filter assertions
// exercise real design-tagged diagnostics.
const DESIGN_RULE_OVERRIDES = {
  "react-doctor/no-gradient-text": "warn",
  "react-doctor/no-pure-black-background": "warn",
  "react-doctor/no-dark-mode-glow": "warn",
  "react-doctor/no-side-tab-border": "warn",
} satisfies Record<string, "error" | "warn" | "off">;

const INDEX_KEY_LIST_SOURCE = `export const List = ({ items }: { items: string[] }) => (
  <div>{items.map((item, index) => <input key={index} defaultValue={item} />)}</div>
);
`;

interface CapturedFetchCall {
  url: string;
  body: string;
}

const decodeRequestBody = (init: RequestInit | undefined): string => {
  const rawBody = init?.body;
  if (!rawBody) return "";
  const encoding = new Headers(init?.headers ?? {}).get("content-encoding")?.toLowerCase() ?? "";
  if (rawBody instanceof Uint8Array) {
    return encoding === "gzip"
      ? gunzipSync(rawBody).toString("utf8")
      : Buffer.from(rawBody).toString("utf8");
  }
  return String(rawBody);
};

const stubScoreFetchAndCapture = (): { captured: CapturedFetchCall[] } => {
  const captured: CapturedFetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url, body: decodeRequestBody(init) });
      return new Response(JSON.stringify({ score: 90, label: "Great" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { captured };
};

describe("inspect — score surface filter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockedComputeProjectedScore.mockClear();
  });

  it("strips `design`-tagged diagnostics before they are sent to the score API", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { captured } = stubScoreFetchAndCapture();
    vi.stubEnv("REACT_DOCTOR_NO_CACHE", "1");

    try {
      const result = await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        deadCode: false,
        noScore: false,
        warnings: true,
        configOverride: { rules: DESIGN_RULE_OVERRIDES },
      });

      const scoreCall = captured.find(({ url }) => url.includes("score"));
      expect(scoreCall).toBeDefined();
      const scorePayload: { diagnostics: Array<{ rule: string; plugin: string }> } = JSON.parse(
        scoreCall?.body ?? "{}",
      );

      const hasDesignTag = (ruleId: string): boolean =>
        reactDoctorPlugin.rules[ruleId]?.tags?.includes("design") ?? false;

      const sentDesignDiagnostics = scorePayload.diagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor" && hasDesignTag(diagnostic.rule),
      );
      expect(sentDesignDiagnostics).toEqual([]);

      const returnedDesignDiagnostics = result.diagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor" && hasDesignTag(diagnostic.rule),
      );
      expect(returnedDesignDiagnostics.length).toBeGreaterThan(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it(
    "projects score gains from production diagnostics while retaining test and story findings",
    { timeout: 60_000 },
    async () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-score-projection-"));
      const projectDirectory = setupReactProject(temporaryDirectory, "app", {
        files: {
          "src/List.tsx": INDEX_KEY_LIST_SOURCE,
          "packages/docusaurus-theme-classic/src/theme/Tabs/__tests__/index.test.tsx":
            INDEX_KEY_LIST_SOURCE,
          "packages/react/context-menu/src/context-menu-controlled.stories.tsx":
            INDEX_KEY_LIST_SOURCE,
          "src/Design.tsx": `export const Design = () => (
  <div style={{ backgroundColor: "#000000", color: "white" }}>content</div>
);
`,
        },
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      stubScoreFetchAndCapture();
      vi.stubEnv("REACT_DOCTOR_NO_CACHE", "1");

      try {
        const configOverride: ReactDoctorConfig = {
          rules: { "react-doctor/no-pure-black-background": "warn" },
        };
        const result = await inspect(projectDirectory, {
          lint: true,
          deadCode: false,
          noScore: false,
          warnings: true,
          configOverride,
        });

        const indexKeyDiagnostics = result.diagnostics.filter(
          (diagnostic) => diagnostic.rule === "no-array-index-as-key",
        );
        expect(indexKeyDiagnostics).toHaveLength(3);
        expect(indexKeyDiagnostics.map((diagnostic) => diagnostic.fileContext)).toEqual([
          "test",
          "story",
          undefined,
        ]);
        expect(mockedComputeProjectedScore).toHaveBeenCalledTimes(1);
        const [topErrorSource, rescoreSource] = mockedComputeProjectedScore.mock.calls[0];
        const scoreDiagnostics = filterDiagnosticsForSurface(
          result.diagnostics,
          "score",
          configOverride,
        );
        expect(scoreDiagnostics.length).toBeGreaterThan(0);
        expect(scoreDiagnostics.every((diagnostic) => diagnostic.fileContext === undefined)).toBe(
          true,
        );
        expect(
          scoreDiagnostics.some(
            (diagnostic) =>
              diagnostic.plugin === "react-doctor" &&
              (reactDoctorPlugin.rules[diagnostic.rule]?.tags?.includes("design") ?? false),
          ),
        ).toBe(false);
        expect(topErrorSource).toEqual(scoreDiagnostics);
        expect(rescoreSource).toEqual(scoreDiagnostics);
      } finally {
        consoleSpy.mockRestore();
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );

  it(
    "projects explicitly included test and story diagnostics with their production sibling",
    { timeout: 60_000 },
    async () => {
      const temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "rd-score-projection-included-"),
      );
      const projectDirectory = setupReactProject(temporaryDirectory, "app", {
        files: {
          "src/List.tsx": INDEX_KEY_LIST_SOURCE,
          "packages/docusaurus-theme-classic/src/theme/Tabs/__tests__/index.test.tsx":
            INDEX_KEY_LIST_SOURCE,
          "packages/react/context-menu/src/context-menu-controlled.stories.tsx":
            INDEX_KEY_LIST_SOURCE,
        },
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      stubScoreFetchAndCapture();
      vi.stubEnv("REACT_DOCTOR_NO_CACHE", "1");

      try {
        const configOverride: ReactDoctorConfig = {
          surfaces: {
            score: { includeFileContexts: ["test", "story"] },
          },
        };
        const result = await inspect(projectDirectory, {
          lint: true,
          deadCode: false,
          noScore: false,
          warnings: true,
          configOverride,
        });

        expect(mockedComputeProjectedScore).toHaveBeenCalledTimes(1);
        const [topErrorSource, rescoreSource] = mockedComputeProjectedScore.mock.calls[0];
        const scoreDiagnostics = filterDiagnosticsForSurface(
          result.diagnostics,
          "score",
          configOverride,
        );
        expect(
          scoreDiagnostics.filter((diagnostic) => diagnostic.fileContext !== undefined),
        ).toHaveLength(2);
        expect(topErrorSource).toEqual(scoreDiagnostics);
        expect(rescoreSource).toEqual(scoreDiagnostics);
      } finally {
        consoleSpy.mockRestore();
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );

  it(
    "does not project a score-eligible rule excluded from the CLI",
    { timeout: 60_000 },
    async () => {
      const temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "rd-score-projection-cli-excluded-"),
      );
      const projectDirectory = setupReactProject(temporaryDirectory, "app", {
        files: { "src/List.tsx": INDEX_KEY_LIST_SOURCE },
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      stubScoreFetchAndCapture();
      vi.stubEnv("REACT_DOCTOR_NO_CACHE", "1");

      try {
        const configOverride: ReactDoctorConfig = {
          surfaces: {
            cli: { excludeRules: ["react-doctor/no-array-index-as-key"] },
            score: { includeRules: ["react-doctor/no-array-index-as-key"] },
          },
        };
        await inspect(projectDirectory, {
          lint: true,
          deadCode: false,
          noScore: false,
          warnings: true,
          configOverride,
        });

        expect(mockedComputeProjectedScore).toHaveBeenCalledTimes(1);
        const [topErrorSource, rescoreSource] = mockedComputeProjectedScore.mock.calls[0];
        expect(
          topErrorSource.some((diagnostic) => diagnostic.rule === "no-array-index-as-key"),
        ).toBe(false);
        expect(
          rescoreSource.some((diagnostic) => diagnostic.rule === "no-array-index-as-key"),
        ).toBe(true);
      } finally {
        consoleSpy.mockRestore();
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );

  // Regression for the Bugbot finding on #271: the `cli` outputSurface
  // used to short-circuit to the raw diagnostic list, which silently
  // dropped any user-configured `surfaces.cli.exclude*` controls before
  // the printed output rendered. The filter now always runs so user
  // overrides on the cli surface flow through end-to-end.
  it(
    "honors user-configured `surfaces.cli` overrides on the printed output",
    { timeout: 60_000 },
    async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      stubScoreFetchAndCapture();
      const printedLines: string[] = [];
      consoleSpy.mockImplementation((...args: unknown[]) => {
        printedLines.push(args.map(String).join(" "));
      });

      try {
        const baselineResult = await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
          lint: true,
          deadCode: false,
          noScore: true,
          warnings: true,
          configOverride: { rules: DESIGN_RULE_OVERRIDES },
        });
        const baselineDesignCount = baselineResult.diagnostics.filter(
          (diagnostic) =>
            diagnostic.plugin === "react-doctor" &&
            (reactDoctorPlugin.rules[diagnostic.rule]?.tags?.includes("design") ?? false),
        ).length;
        expect(baselineDesignCount).toBeGreaterThan(0);
        printedLines.length = 0;

        await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
          lint: true,
          deadCode: false,
          noScore: true,
          warnings: true,
          outputSurface: "cli",
          configOverride: {
            rules: DESIGN_RULE_OVERRIDES,
            surfaces: { cli: { excludeTags: ["design"] } },
          },
        });

        const printedText = printedLines.join("\n");
        expect(printedText).toContain(`${baselineDesignCount} demoted from the cli surface`);
      } finally {
        consoleSpy.mockRestore();
      }
    },
  );
});
