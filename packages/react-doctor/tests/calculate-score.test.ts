import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { calculateScoreLocally } from "../src/core/scoring/calculate-score-locally.js";
import { tryScoreFromApi } from "../src/core/scoring/try-score-from-api.js";
import { calculateScore } from "../src/core/scoring/calculate-score.js";
import type { Diagnostic } from "../src/types/diagnostic.js";

const sampleDiagnostics: Diagnostic[] = [
  {
    filePath: "src/App.tsx",
    plugin: "react-doctor",
    rule: "example-rule",
    severity: "error",
    message: "Example",
    help: "",
    line: 1,
    column: 1,
    category: "performance",
  },
];

const apiScoreResponse = { score: 73, label: "Needs work" } as const;

describe("score calculation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("tryScoreFromApi", () => {
    it("returns null and logs a warning when fetch throws", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const failingFetch = vi.fn(async () => {
        throw new Error("network unavailable");
      }) as unknown as typeof fetch;

      const result = await tryScoreFromApi(sampleDiagnostics, failingFetch);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("returns null when no fetch implementation is supplied", async () => {
      const result = await tryScoreFromApi(sampleDiagnostics, undefined);
      expect(result).toBeNull();
    });

    it("returns null and logs a warning when the API responds non-2xx", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorFetch = vi.fn(
        async () => new Response("boom", { status: 500, statusText: "Internal Server Error" }),
      ) as unknown as typeof fetch;

      const result = await tryScoreFromApi(sampleDiagnostics, errorFetch);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("parses a well-formed API response and strips file paths from the request body", async () => {
      let capturedBody: string | undefined;
      const goodFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify(apiScoreResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const result = await tryScoreFromApi(sampleDiagnostics, goodFetch);

      expect(result).toEqual(apiScoreResponse);
      const parsedBody: { diagnostics: Array<Record<string, unknown>> } = JSON.parse(
        capturedBody ?? "{}",
      );
      expect(parsedBody.diagnostics).toHaveLength(1);
      expect(parsedBody.diagnostics[0]).not.toHaveProperty("filePath");
      expect(parsedBody.diagnostics[0]).toMatchObject({
        plugin: "react-doctor",
        rule: "example-rule",
        severity: "error",
      });
    });

    it("returns null when the API response shape is invalid", async () => {
      const malformedFetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ score: "high" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ) as unknown as typeof fetch;

      const result = await tryScoreFromApi(sampleDiagnostics, malformedFetch);
      expect(result).toBeNull();
    });
  });

  describe("calculateScore (Node entrypoint)", () => {
    it("falls back to calculateScoreLocally when the score API is unreachable", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network unavailable");
        }),
      );

      const expected = calculateScoreLocally(sampleDiagnostics);
      const score = await calculateScore(sampleDiagnostics);

      expect(score).toEqual(expected);
    });

    it("returns the API score when the API succeeds", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(apiScoreResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );

      const score = await calculateScore(sampleDiagnostics);
      expect(score).toEqual(apiScoreResponse);
    });
  });
});
