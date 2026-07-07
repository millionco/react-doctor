import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_FILENAME_HASH_LENGTH_CHARS,
  SUPPLY_CHAIN_CACHE_SUBDIR,
  SUPPLY_CHAIN_CACHE_TTL_MS,
} from "../src/constants.js";
import { checkSupplyChain } from "../src/check-supply-chain.js";
import type { ReactDoctorConfig } from "../src/types/index.js";
import { resolveReactDoctorCacheDir } from "../src/utils/resolve-react-doctor-cache-dir.js";

interface OsvQueryVulnerability {
  readonly id: string;
  readonly summary?: string;
  readonly database_specific?: {
    readonly severity?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  };
}

const createProjectDirectory = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-osv-cache-"));

const writePackageJson = (rootDirectory: string): void => {
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "test-project",
        private: true,
        version: "1.0.0",
        dependencies: {
          "left-pad": "1.0.0",
        },
      },
      null,
      2,
    )}\n`,
  );
};

const runCheckSupplyChain = async (
  rootDirectory: string,
  userConfig: ReactDoctorConfig | null = null,
) =>
  Effect.runPromise(
    checkSupplyChain({
      rootDirectory,
      userConfig,
    }),
  );

const createOsvQueryVulnerability = (input: OsvQueryVulnerability): Record<string, unknown> => ({
  id: input.id,
  summary: input.summary ?? input.id,
  ...(input.database_specific !== undefined ? { database_specific: input.database_specific } : {}),
});

const createOsvQueryResponse = (
  vulnerabilities: ReadonlyArray<OsvQueryVulnerability>,
): Record<string, unknown> => ({
  vulns: vulnerabilities.map(createOsvQueryVulnerability),
});

const stubOsvFetch = (
  queryResponseByPackage: Record<string, ReadonlyArray<OsvQueryVulnerability>>,
): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = String(requestInput);
    if (requestUrl.endsWith("/v1/querybatch")) {
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const queries = Array.isArray(payload.queries)
        ? (payload.queries as ReadonlyArray<Record<string, unknown>>)
        : [];
      return new Response(
        JSON.stringify({
          results: queries.map((query) => {
            const packageName =
              typeof query.package === "object" &&
              query.package !== null &&
              typeof query.package.name === "string"
                ? query.package.name
                : "";
            return packageName === "left-pad" ? { vulns: [{ id: "GHSA-cache" }] } : {};
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (requestUrl.endsWith("/v1/query")) {
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const packageName =
        typeof payload.package === "object" &&
        payload.package !== null &&
        typeof payload.package.name === "string"
          ? payload.package.name
          : "";
      const vulnerabilities = queryResponseByPackage[packageName] ?? [];
      return new Response(JSON.stringify(createOsvQueryResponse(vulnerabilities)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const cacheFileFor = (rootDirectory: string): string => {
  const purlHash = crypto
    .createHash("sha256")
    .update("pkg:npm/left-pad@1.0.0")
    .digest("hex")
    .slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);
  return path.join(
    resolveReactDoctorCacheDir(rootDirectory),
    SUPPLY_CHAIN_CACHE_SUBDIR,
    `${purlHash}.json`,
  );
};

const writeCacheEntry = (cacheFile: string, entry: unknown): void => {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(entry));
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["REACT_DOCTOR_CACHE_DIR"];
  delete process.env["REACT_DOCTOR_NO_CACHE"];
});

describe("checkSupplyChain cache", () => {
  it("reuses the cached vulnerability summary on a repeat scan", async () => {
    const rootDirectory = createProjectDirectory();
    const cacheDirectory = path.join(rootDirectory, "cache");
    process.env["REACT_DOCTOR_CACHE_DIR"] = cacheDirectory;
    try {
      writePackageJson(rootDirectory);
      const fetchMock = stubOsvFetch({
        "left-pad": [
          {
            id: "GHSA-cache",
            database_specific: { severity: "HIGH" },
          },
        ],
      });

      const firstDiagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "low",
        },
      });
      expect(firstDiagnostics).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalled();

      fetchMock.mockClear();

      const secondDiagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "low",
        },
      });
      expect(secondDiagnostics).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("re-fetches when the cached body is malformed", async () => {
    const rootDirectory = createProjectDirectory();
    const cacheDirectory = path.join(rootDirectory, "cache");
    process.env["REACT_DOCTOR_CACHE_DIR"] = cacheDirectory;
    try {
      writePackageJson(rootDirectory);
      const cacheFile = cacheFileFor(rootDirectory);
      writeCacheEntry(cacheFile, {
        fetchedAtMs: Date.now(),
        body: "old OSV cache body",
      });
      const fetchMock = stubOsvFetch({
        "left-pad": [
          {
            id: "GHSA-cache",
            database_specific: { severity: "HIGH" },
          },
        ],
      });

      const diagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "low",
        },
      });

      expect(diagnostics).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("prunes stale cache files before scanning", async () => {
    const rootDirectory = createProjectDirectory();
    const cacheDirectory = path.join(rootDirectory, "cache");
    process.env["REACT_DOCTOR_CACHE_DIR"] = cacheDirectory;
    try {
      writePackageJson(rootDirectory);
      const resolvedCacheDirectory = resolveReactDoctorCacheDir(rootDirectory);
      const staleFile = path.join(resolvedCacheDirectory, SUPPLY_CHAIN_CACHE_SUBDIR, "stale.json");
      writeCacheEntry(staleFile, {
        fetchedAtMs: Date.now() - 2 * SUPPLY_CHAIN_CACHE_TTL_MS,
        vulns: [],
      });
      fs.utimesSync(
        staleFile,
        new Date(Date.now() - 2 * SUPPLY_CHAIN_CACHE_TTL_MS),
        new Date(Date.now() - 2 * SUPPLY_CHAIN_CACHE_TTL_MS),
      );
      stubOsvFetch({
        "left-pad": [
          {
            id: "GHSA-cache",
            database_specific: { severity: "HIGH" },
          },
        ],
      });

      await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "low",
        },
      });

      expect(fs.existsSync(staleFile)).toBe(false);
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("ignores cache entries when REACT_DOCTOR_NO_CACHE is enabled", async () => {
    const rootDirectory = createProjectDirectory();
    const cacheDirectory = path.join(rootDirectory, "cache");
    process.env["REACT_DOCTOR_CACHE_DIR"] = cacheDirectory;
    process.env["REACT_DOCTOR_NO_CACHE"] = "1";
    try {
      writePackageJson(rootDirectory);
      writeCacheEntry(cacheFileFor(rootDirectory), {
        fetchedAtMs: Date.now(),
        vulns: [
          {
            id: "GHSA-cache",
            severity: "high",
            summary: "cached",
            pageUrl: "https://osv.dev/vulnerability/GHSA-cache",
          },
        ],
      });
      const fetchMock = stubOsvFetch({
        "left-pad": [
          {
            id: "GHSA-cache",
            database_specific: { severity: "HIGH" },
          },
        ],
      });

      const diagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "low",
        },
      });

      expect(diagnostics).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
