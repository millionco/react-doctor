import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { checkSupplyChain } from "@react-doctor/core";

// A low-score artifact so the check emits a diagnostic (lets us assert the
// cached run reproduces it). NDJSON line shape the free Socket endpoint streams.
const lowScoreArtifactBody = (): string =>
  JSON.stringify({
    id: "test-artifact",
    type: "npm",
    score: {
      supplyChain: 0.1,
      vulnerability: 0.1,
      maintenance: 0.1,
      quality: 0.1,
      license: 0.1,
      overall: 0.1,
    },
    alerts: [],
  });

// The on-disk cache nests under a per-project hash subdir (and a `supply-chain`
// subdir), so collect every cache `.json` by walking rather than guessing.
const walkCacheFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkCacheFiles(entryPath);
    return entry.name.endsWith(".json") ? [entryPath] : [];
  });

let projectDirectory: string;
let cacheDirectory: string;
const originalCacheDirEnv = process.env["REACT_DOCTOR_CACHE_DIR"];
const originalNoCacheEnv = process.env["REACT_DOCTOR_NO_CACHE"];

beforeEach(() => {
  projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sc-cache-proj-"));
  cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sc-cache-dir-"));
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { "left-pad": "1.3.0" } }),
  );
  // Point the cache at an isolated dir; ensure the cache isn't globally disabled.
  process.env["REACT_DOCTOR_CACHE_DIR"] = cacheDirectory;
  delete process.env["REACT_DOCTOR_NO_CACHE"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(projectDirectory, { recursive: true, force: true });
  fs.rmSync(cacheDirectory, { recursive: true, force: true });
  if (originalCacheDirEnv === undefined) delete process.env["REACT_DOCTOR_CACHE_DIR"];
  else process.env["REACT_DOCTOR_CACHE_DIR"] = originalCacheDirEnv;
  if (originalNoCacheEnv === undefined) delete process.env["REACT_DOCTOR_NO_CACHE"];
  else process.env["REACT_DOCTOR_NO_CACHE"] = originalNoCacheEnv;
});

const stubSocketFetch = () => {
  const fetchMock = vi.fn(async () => new Response(lowScoreArtifactBody(), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const runCheck = () =>
  Effect.runPromise(checkSupplyChain({ rootDirectory: projectDirectory, userConfig: null }));

describe("supply-chain on-disk cache", () => {
  it("skips the network on a repeat scan within the TTL (cache hit), reproducing the diagnostic", async () => {
    const fetchMock = stubSocketFetch();
    const first = await runCheck();
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0); // the first scan fetched
    expect(first.length).toBeGreaterThan(0); // low score ⇒ a diagnostic

    const second = await runCheck();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // no new network calls
    expect(second).toEqual(first); // identical diagnostics, served from cache
  });

  it("treats an unparseable cached body as a miss and re-fetches (corruption / schema drift)", async () => {
    const fetchMock = stubSocketFetch();
    const first = await runCheck();
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(first.length).toBeGreaterThan(0);

    // Corrupt the cached body in place while keeping a fresh, in-TTL envelope —
    // the read still returns a string, but it no longer parses to an artifact.
    // This is the corrupted-restore / Socket-schema-drift case: it must fall
    // through to the network, not silently skip the advisory for the whole TTL.
    // The cache nests under a per-project subdir, so walk for the `.json` files.
    const cacheFiles = walkCacheFiles(cacheDirectory);
    expect(cacheFiles.length).toBeGreaterThan(0); // the first scan populated it
    for (const cacheFile of cacheFiles) {
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({ fetchedAtMs: Date.now(), body: "not-valid-json\n{partial" }),
      );
    }

    const second = await runCheck();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst); // re-fetched
    expect(second).toEqual(first); // advisory still produced from the fresh fetch
  });

  it("re-fetches every run when REACT_DOCTOR_NO_CACHE is set (cache bypassed)", async () => {
    process.env["REACT_DOCTOR_NO_CACHE"] = "1";
    const fetchMock = stubSocketFetch();
    await runCheck();
    const callsAfterFirst = fetchMock.mock.calls.length;
    await runCheck();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
