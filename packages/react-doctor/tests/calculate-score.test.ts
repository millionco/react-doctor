import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { calculateScore } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/types";

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

const stubFetch = (impl: typeof fetch): void => {
  vi.stubGlobal("fetch", vi.fn(impl));
};

describe("calculateScore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null and logs a warning when fetch throws", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => {
      throw new Error("network unavailable");
    });

    const result = await calculateScore(sampleDiagnostics);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("returns null and logs a warning when the API responds non-2xx", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(
      async () => new Response("boom", { status: 500, statusText: "Internal Server Error" }),
    );

    const result = await calculateScore(sampleDiagnostics);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("parses a well-formed API response and strips file paths from the request body", async () => {
    let capturedBody: string | undefined;
    stubFetch(async (_url, init) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify(apiScoreResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await calculateScore(sampleDiagnostics);

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
    stubFetch(
      async () =>
        new Response(JSON.stringify({ score: "high" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const result = await calculateScore(sampleDiagnostics);
    expect(result).toBeNull();
  });
});
