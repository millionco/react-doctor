import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { calculateScore } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

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

  it("parses a well-formed API response and sends score metadata", async () => {
    let capturedBody: BodyInit | null | undefined;
    let capturedHeaders: HeadersInit | undefined;
    stubFetch(async (_url, init) => {
      capturedBody = init?.body;
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify(apiScoreResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await calculateScore(sampleDiagnostics, {
      metadata: {
        repo: "millionco/react-doctor",
        sha: "abc123",
        framework: "nextjs",
        reactVersion: "19.2.0",
        sourceFileCount: 42,
        defaultBranch: "main",
        doctorVersion: "0.2.5",
        githubEventName: "pull_request",
        githubActorAssociation: "CONTRIBUTOR",
        githubViewerPermission: "write",
      },
    });

    expect(result).toEqual(apiScoreResponse);
    const headerRecord = capturedHeaders as Record<string, string> | undefined;
    expect(headerRecord?.["Content-Encoding"]).toBe("gzip");
    const compressedBytes = capturedBody as Uint8Array;
    expect(compressedBytes).toBeInstanceOf(Uint8Array);
    const decompressedJson = gunzipSync(compressedBytes).toString("utf8");
    const parsedBody: { diagnostics: Array<Record<string, unknown>> } =
      JSON.parse(decompressedJson);
    expect(parsedBody.diagnostics).toHaveLength(1);
    expect(parsedBody.diagnostics[0]).not.toHaveProperty("filePath");
    expect(parsedBody.diagnostics[0]).toMatchObject({
      plugin: "react-doctor",
      rule: "example-rule",
      severity: "error",
    });
    expect(parsedBody).toMatchObject({
      repo: "millionco/react-doctor",
      sha: "abc123",
      framework: "nextjs",
      reactVersion: "19.2.0",
      sourceFileCount: 42,
      defaultBranch: "main",
      doctorVersion: "0.2.5",
      githubEventName: "pull_request",
      githubActorAssociation: "CONTRIBUTOR",
      githubViewerPermission: "write",
    });
  });

  it("issue #302: tags the score request with ?ci=1 when isCi is true", async () => {
    let capturedUrl: string | URL | Request | undefined;
    stubFetch(async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify(apiScoreResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await calculateScore(sampleDiagnostics);
    expect(String(capturedUrl)).not.toContain("ci=1");

    await calculateScore(sampleDiagnostics, { isCi: true });
    expect(String(capturedUrl)).toContain("?ci=1");
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
