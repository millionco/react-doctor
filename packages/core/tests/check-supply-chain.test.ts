import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CACHE_FILENAME_HASH_LENGTH_CHARS, SUPPLY_CHAIN_CACHE_SUBDIR } from "../src/constants.js";
import { checkSupplyChain } from "../src/check-supply-chain.js";
import type { ReactDoctorConfig } from "../src/types/index.js";
import { resolveReactDoctorCacheDir } from "../src/utils/resolve-react-doctor-cache-dir.js";

interface OsvQueryVulnerability {
  readonly id: string;
  readonly summary?: string;
  readonly details?: string;
  readonly database_specific?: {
    readonly severity?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  };
  readonly severity?: ReadonlyArray<{
    readonly type?: string;
    readonly score?: string;
  }>;
}

interface OsvTestFetchResult {
  readonly fetchMock: ReturnType<typeof vi.fn>;
  readonly queryBatchRequests: Array<
    ReadonlyArray<{ readonly name: string; readonly version: string }>
  >;
  readonly queryRequests: string[];
}

const createProjectDirectory = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-osv-"));

const writePackageJson = (
  rootDirectory: string,
  packageJson: {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
  },
): void => {
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "test-project",
        private: true,
        version: "1.0.0",
        ...packageJson,
      },
      null,
      2,
    )}\n`,
  );
};

const runCheckSupplyChain = async (
  rootDirectory: string,
  userConfig: ReactDoctorConfig | null = null,
  totalTimeoutMs?: number,
) =>
  Effect.runPromise(
    checkSupplyChain({
      rootDirectory,
      userConfig,
      totalTimeoutMs,
    }),
  );

const cacheFileFor = (rootDirectory: string, name: string, version: string): string => {
  const purlHash = crypto
    .createHash("sha256")
    .update(`pkg:npm/${name}@${version}`)
    .digest("hex")
    .slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);
  return path.join(
    resolveReactDoctorCacheDir(rootDirectory),
    SUPPLY_CHAIN_CACHE_SUBDIR,
    `${purlHash}.json`,
  );
};

const createOsvQueryVulnerability = (input: OsvQueryVulnerability): Record<string, unknown> => ({
  id: input.id,
  summary: input.summary ?? input.id,
  ...(input.details !== undefined ? { details: input.details } : {}),
  ...(input.database_specific !== undefined ? { database_specific: input.database_specific } : {}),
  ...(input.severity !== undefined ? { severity: input.severity } : {}),
});

const createOsvQueryResponse = (
  vulnerabilities: ReadonlyArray<OsvQueryVulnerability>,
): Record<string, unknown> => ({
  vulns: vulnerabilities.map(createOsvQueryVulnerability),
});

const stubOsvFetch = (input: {
  readonly queryBatchIdsByPackage?: Record<string, ReadonlyArray<string>>;
  readonly queryResponseByPackage?: Record<string, ReadonlyArray<OsvQueryVulnerability>>;
  readonly queryFailurePackages?: ReadonlySet<string>;
}): OsvTestFetchResult => {
  const queryBatchRequests: Array<
    ReadonlyArray<{ readonly name: string; readonly version: string }>
  > = [];
  const queryRequests: string[] = [];

  const fetchMock = vi.fn(async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = String(requestInput);
    if (requestUrl.endsWith("/v1/querybatch")) {
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const queries = Array.isArray(payload.queries)
        ? (payload.queries as ReadonlyArray<Record<string, unknown>>)
        : [];
      queryBatchRequests.push(
        queries.map((query) => ({
          name:
            typeof query.package === "object" &&
            query.package !== null &&
            typeof query.package.name === "string"
              ? query.package.name
              : "",
          version: typeof query.version === "string" ? query.version : "",
        })),
      );

      return new Response(
        JSON.stringify({
          results: queries.map((query) => {
            const packageName =
              typeof query.package === "object" &&
              query.package !== null &&
              typeof query.package.name === "string"
                ? query.package.name
                : "";
            const vulnerabilityIds = input.queryBatchIdsByPackage?.[packageName] ?? [];
            return vulnerabilityIds.length > 0
              ? { vulns: vulnerabilityIds.map((id) => ({ id })) }
              : {};
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
      queryRequests.push(packageName);

      if (input.queryFailurePackages?.has(packageName) === true) {
        return new Response("temporary failure", { status: 503 });
      }

      const vulnerabilities = input.queryResponseByPackage?.[packageName] ?? [];
      return new Response(JSON.stringify(createOsvQueryResponse(vulnerabilities)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    queryBatchRequests,
    queryRequests,
  };
};

const stubHangingOsvFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["REACT_DOCTOR_CACHE_DIR"];
  delete process.env["REACT_DOCTOR_NO_CACHE"];
});

describe("checkSupplyChain (OSV)", () => {
  it.each([
    { threshold: "low", severity: "LOW", expectDiagnostic: true },
    { threshold: "moderate", severity: "LOW", expectDiagnostic: false },
    { threshold: "moderate", severity: "MODERATE", expectDiagnostic: true },
    { threshold: "high", severity: "MODERATE", expectDiagnostic: false },
    { threshold: "high", severity: "HIGH", expectDiagnostic: true },
    { threshold: "critical", severity: "HIGH", expectDiagnostic: false },
    { threshold: "critical", severity: "CRITICAL", expectDiagnostic: true },
  ] as const)(
    "gates $severity advisories at failOn=$threshold",
    async ({ threshold, severity, expectDiagnostic }) => {
      const rootDirectory = createProjectDirectory();
      try {
        writePackageJson(rootDirectory, {
          dependencies: {
            "left-pad": "1.0.0",
          },
        });
        stubOsvFetch({
          queryBatchIdsByPackage: {
            "left-pad": ["GHSA-test-1"],
          },
          queryResponseByPackage: {
            "left-pad": [
              createOsvQueryVulnerability({
                id: "GHSA-test-1",
                database_specific: { severity },
              }),
            ],
          },
        });

        const diagnostics = await runCheckSupplyChain(rootDirectory, {
          supplyChain: {
            failOn: threshold,
          },
        });

        expect(diagnostics).toHaveLength(expectDiagnostic ? 1 : 0);
        if (expectDiagnostic) {
          expect(diagnostics[0].plugin).toBe("osv");
          expect(diagnostics[0].rule).toBe("known-vulnerability");
          expect(diagnostics[0].category).toBe("Security");
          expect(diagnostics[0].filePath).toBe("package.json");
        }
      } finally {
        fs.rmSync(rootDirectory, { recursive: true, force: true });
      }
    },
  );

  it("names the worst severity and lists every matching advisory id", async () => {
    const rootDirectory = createProjectDirectory();
    try {
      writePackageJson(rootDirectory, {
        dependencies: {
          lodash: "4.17.11",
        },
      });
      stubOsvFetch({
        queryBatchIdsByPackage: {
          lodash: ["GHSA-high", "GHSA-moderate"],
        },
        queryResponseByPackage: {
          lodash: [
            createOsvQueryVulnerability({
              id: "GHSA-high",
              database_specific: { severity: "HIGH" },
            }),
            createOsvQueryVulnerability({
              id: "GHSA-moderate",
              database_specific: { severity: "MODERATE" },
            }),
          ],
        },
      });

      const diagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "moderate",
        },
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain(
        "2 high-severity known vulnerabilities: GHSA-high, GHSA-moderate.",
      );
      expect(diagnostics[0].url).toBe("https://osv.dev/vulnerability/GHSA-high");
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    { id: "MAL-2025-0001", summary: "A malicious package", label: "MAL prefix" },
    { id: "GHSA-malicious", summary: "Malicious Package", label: "GHSA malicious summary" },
  ] as const)("always flags malware advisories from $label", async ({ id, summary }) => {
    const rootDirectory = createProjectDirectory();
    try {
      writePackageJson(rootDirectory, {
        dependencies: {
          "event-stream": "4.0.0",
        },
      });
      stubOsvFetch({
        queryBatchIdsByPackage: {
          "event-stream": [id],
        },
        queryResponseByPackage: {
          "event-stream": [
            createOsvQueryVulnerability({
              id,
              summary,
            }),
          ],
        },
      });

      const diagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "critical",
        },
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain("known malicious package advisory");
      expect(diagnostics[0].message).toContain(id);
      expect(diagnostics[0].help).toContain("package.json and your lockfile");
      expect(diagnostics[0].help).toContain("supplyChain.enabled: false");
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("parses CVSS vectors when database_specific severity is absent", async () => {
    const rootDirectory = createProjectDirectory();
    try {
      writePackageJson(rootDirectory, {
        dependencies: {
          semver: "7.7.4",
        },
      });
      stubOsvFetch({
        queryBatchIdsByPackage: {
          semver: ["GHSA-cvss"],
        },
        queryResponseByPackage: {
          semver: [
            createOsvQueryVulnerability({
              id: "GHSA-cvss",
              severity: [
                {
                  type: "CVSS_V3",
                  score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                },
              ],
            }),
          ],
        },
      });

      const diagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "high",
        },
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain("critical-severity known vulnerability");
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("skips dist-tags, wildcards, and protocol specs, and honors includeDevDependencies: false", async () => {
    const rootDirectory = createProjectDirectory();
    try {
      writePackageJson(rootDirectory, {
        dependencies: {
          "scored-package": "1.2.3",
          "tagged-package": "latest",
          "wildcard-package": "*",
          "protocol-package": "file:../local",
        },
        devDependencies: {
          "dev-only": "2.0.0",
        },
      });
      const stub = stubOsvFetch({
        queryBatchIdsByPackage: {
          "scored-package": ["GHSA-score"],
        },
        queryResponseByPackage: {
          "scored-package": [
            createOsvQueryVulnerability({
              id: "GHSA-score",
              database_specific: { severity: "LOW" },
            }),
          ],
        },
      });

      const diagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          includeDevDependencies: false,
          failOn: "low",
        },
      });

      expect(diagnostics).toHaveLength(1);
      expect(stub.queryBatchRequests).toHaveLength(1);
      expect(stub.queryBatchRequests[0].map((query) => query.name)).toEqual(["scored-package"]);
      expect(stub.queryRequests).toEqual(["scored-package"]);
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("fails open on a package query error without caching a partial result", async () => {
    const rootDirectory = createProjectDirectory();
    const cacheDirectory = path.join(rootDirectory, "cache");
    process.env["REACT_DOCTOR_CACHE_DIR"] = cacheDirectory;
    try {
      writePackageJson(rootDirectory, {
        dependencies: {
          lodash: "4.17.11",
        },
      });
      stubOsvFetch({
        queryBatchIdsByPackage: {
          lodash: ["GHSA-jf85-cpcp-j695"],
        },
        queryFailurePackages: new Set(["lodash"]),
      });

      const failedDiagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "low",
        },
      });

      expect(failedDiagnostics).toEqual([]);
      expect(fs.existsSync(cacheFileFor(rootDirectory, "lodash", "4.17.11"))).toBe(false);

      vi.unstubAllGlobals();
      stubOsvFetch({
        queryBatchIdsByPackage: {
          lodash: ["GHSA-jf85-cpcp-j695"],
        },
        queryResponseByPackage: {
          lodash: [
            createOsvQueryVulnerability({
              id: "GHSA-jf85-cpcp-j695",
              database_specific: { severity: "CRITICAL" },
            }),
          ],
        },
      });

      const recoveredDiagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "low",
        },
      });

      expect(recoveredDiagnostics).toHaveLength(1);
      expect(recoveredDiagnostics[0].message).toContain("GHSA-jf85-cpcp-j695");
      expect(fs.existsSync(cacheFileFor(rootDirectory, "lodash", "4.17.11"))).toBe(true);
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("fails open when the whole check exceeds its timeout budget", async () => {
    const rootDirectory = createProjectDirectory();
    try {
      writePackageJson(rootDirectory, {
        dependencies: {
          lodash: "4.17.11",
        },
      });
      stubHangingOsvFetch();

      const diagnostics = await runCheckSupplyChain(
        rootDirectory,
        {
          supplyChain: {
            failOn: "low",
          },
        },
        20,
      );

      expect(diagnostics).toEqual([]);
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
