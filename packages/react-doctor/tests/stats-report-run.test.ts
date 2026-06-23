import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { reportStatsRun } from "../src/stats/report-stats-run.js";
import type { GroupStats, StatsReport } from "../src/stats/types.js";

const group = (overrides: Partial<GroupStats>): GroupStats => ({
  key: "claude/claude-sonnet-4-5",
  provider: "claude",
  sessions: 2,
  filesScanned: 8,
  unreconstructable: 0,
  totalDiagnostics: 3,
  errorCount: 1,
  warningCount: 2,
  diagnosticsPerFile: 0.375,
  score: 90,
  scoreLabel: "Great",
  weightedScore: 84,
  // topRules carries rule messages — must NEVER reach the wire payload.
  topRules: [{ rule: "react-doctor/no-array-index-key", count: 3 }],
  ...overrides,
});

const report = (models: GroupStats[]): StatsReport => ({
  scope: "repo",
  directory: "/repo",
  models,
  providers: [group({ key: "claude", provider: "claude" })],
  best: models[0] ?? null,
  worst: null,
  sessionsAnalyzed: 4,
  sessionsRanked: 2,
  sessionsNonReact: 1,
  sessionsUnreconstructable: 0,
  generatedAt: "2026-06-22T00:00:00.000Z",
});

const stubFetch = (impl: typeof fetch): void => {
  vi.stubGlobal("fetch", vi.fn(impl));
};

const decodeBody = (body: BodyInit | null | undefined): unknown =>
  JSON.parse(gunzipSync(body as Uint8Array).toString("utf8"));

describe("reportStatsRun", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends only the four code-free leaderboard fields per row — no source, paths, or identity", async () => {
    let captured: unknown;
    stubFetch(async (_url, init) => {
      captured = decodeBody(init?.body);
      return new Response(JSON.stringify({ stored: true }), { status: 200 });
    });

    await reportStatsRun(report([group({})]));

    expect(captured).toEqual({
      schemaVersion: 1,
      models: [{ model: "claude-sonnet-4-5", harness: "claude", score: 84, files: 8 }],
    });
    // Belt-and-suspenders: the serialized body must carry none of the leaky fields.
    const serialized = JSON.stringify(captured);
    for (const leak of [
      "topRules",
      "message",
      "help",
      "filePath",
      "repo",
      "sha",
      "directory",
      "no-array-index-key",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("gzips the body and returns the parsed community leaderboard", async () => {
    let encoding: string | undefined;
    stubFetch(async (_url, init) => {
      encoding = new Headers(init?.headers).get("content-encoding") ?? undefined;
      return new Response(
        JSON.stringify({
          stored: true,
          community: {
            generatedAt: "2026-06-22T00:00:00.000Z",
            models: [
              {
                model: "claude-sonnet-4-5",
                harness: "claude",
                communityScore: 81,
                runs: 42,
                files: 900,
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const community = await reportStatsRun(report([group({})]));

    expect(encoding).toBe("gzip");
    expect(community?.models[0]).toEqual({
      model: "claude-sonnet-4-5",
      harness: "claude",
      communityScore: 81,
      runs: 42,
      files: 900,
    });
  });

  it("returns null (never throws) when the API is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => {
      throw new Error("network unavailable");
    });
    expect(await reportStatsRun(report([group({})]))).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => new Response("boom", { status: 500, statusText: "Server Error" }));
    expect(await reportStatsRun(report([group({})]))).toBeNull();
  });

  it("returns null when the response omits a community board", async () => {
    stubFetch(async () => new Response(JSON.stringify({ stored: true }), { status: 200 }));
    expect(await reportStatsRun(report([group({})]))).toBeNull();
  });
});
