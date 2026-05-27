import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { inspect } from "../src/inspect.js";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";

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
  });

  it("strips `design`-tagged diagnostics before they are sent to the score API", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { captured } = stubScoreFetchAndCapture();

    try {
      const result = await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        noScore: false,
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
          noScore: true,
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
          noScore: true,
          outputSurface: "cli",
          configOverride: { surfaces: { cli: { excludeTags: ["design"] } } },
        });

        const printedText = printedLines.join("\n");
        expect(printedText).toContain(`${baselineDesignCount} demoted from the cli surface`);
      } finally {
        consoleSpy.mockRestore();
      }
    },
  );
});
