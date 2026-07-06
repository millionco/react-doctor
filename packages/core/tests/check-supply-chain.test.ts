import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSupplyChain } from "../src/check-supply-chain.js";
import type { ReactDoctorConfig } from "../src/types/index.js";

interface OsvDetailInput {
  readonly id: string;
  readonly summary?: string;
  readonly details?: string;
  readonly databaseSpecificSeverity?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  readonly cvssVector?: string;
}

interface StubOsvResult {
  readonly fetchMock: ReturnType<typeof vi.fn>;
  readonly queryBatchRequests: Array<
    ReadonlyArray<{ readonly name: string; readonly version: string }>
  >;
  readonly vulnerabilityRequests: string[];
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

const createOsvDetail = (input: OsvDetailInput): Record<string, unknown> => ({
  id: input.id,
  summary: input.summary ?? input.id,
  ...(input.details !== undefined ? { details: input.details } : {}),
  ...(input.databaseSpecificSeverity !== undefined
    ? { database_specific: { severity: input.databaseSpecificSeverity } }
    : {}),
  ...(input.cvssVector !== undefined
    ? {
        severity: [
          {
            type: "CVSS_V3",
            score: input.cvssVector,
          },
        ],
      }
    : {}),
});

const stubOsvFetch = (
  packageIdsByName: Record<string, ReadonlyArray<string>>,
  detailById: Record<string, Record<string, unknown>>,
): StubOsvResult => {
  const queryBatchRequests: Array<
    ReadonlyArray<{ readonly name: string; readonly version: string }>
  > = [];
  const vulnerabilityRequests: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = String(input);
    if (requestUrl.endsWith("/v1/querybatch")) {
      const payload: unknown = JSON.parse(String(init?.body ?? "{}"));
      const queries = Array.isArray((payload as Record<string, unknown>).queries)
        ? ((payload as Record<string, unknown>).queries as ReadonlyArray<Record<string, unknown>>)
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
            const vulnerabilityIds = packageIdsByName[packageName] ?? [];
            return vulnerabilityIds.length > 0
              ? { vulns: vulnerabilityIds.map((id) => ({ id })) }
              : {};
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (requestUrl.includes("/v1/vulns/")) {
      const id = decodeURIComponent(requestUrl.slice(requestUrl.lastIndexOf("/") + 1));
      vulnerabilityRequests.push(id);
      const detail = detailById[id];
      if (detail === undefined) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(detail), {
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
    vulnerabilityRequests,
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
    { threshold: "low", detailSeverity: "LOW", expectDiagnostic: true },
    { threshold: "moderate", detailSeverity: "LOW", expectDiagnostic: false },
    { threshold: "moderate", detailSeverity: "MODERATE", expectDiagnostic: true },
    { threshold: "high", detailSeverity: "MODERATE", expectDiagnostic: false },
    { threshold: "high", detailSeverity: "HIGH", expectDiagnostic: true },
    { threshold: "critical", detailSeverity: "HIGH", expectDiagnostic: false },
    { threshold: "critical", detailSeverity: "CRITICAL", expectDiagnostic: true },
  ] as const)(
    "gates $detailSeverity advisories at failOn=$threshold",
    async ({ threshold, detailSeverity, expectDiagnostic }) => {
      const rootDirectory = createProjectDirectory();
      try {
        writePackageJson(rootDirectory, {
          dependencies: {
            "left-pad": "1.0.0",
          },
        });
        stubOsvFetch(
          { "left-pad": ["GHSA-test-1"] },
          {
            "GHSA-test-1": createOsvDetail({
              id: "GHSA-test-1",
              databaseSpecificSeverity: detailSeverity,
            }),
          },
        );

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
          expect(diagnostics[0].message).toContain(`${threshold}-severity`);
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
      stubOsvFetch(
        { lodash: ["GHSA-high", "GHSA-moderate"] },
        {
          "GHSA-high": createOsvDetail({
            id: "GHSA-high",
            databaseSpecificSeverity: "HIGH",
          }),
          "GHSA-moderate": createOsvDetail({
            id: "GHSA-moderate",
            databaseSpecificSeverity: "MODERATE",
          }),
        },
      );

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
      stubOsvFetch(
        { "event-stream": [id] },
        {
          [id]: createOsvDetail({
            id,
            summary,
          }),
        },
      );

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
      stubOsvFetch(
        { semver: ["GHSA-cvss"] },
        {
          "GHSA-cvss": createOsvDetail({
            id: "GHSA-cvss",
            cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
          }),
        },
      );

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
      const stub = stubOsvFetch(
        { "scored-package": ["GHSA-score"] },
        {
          "GHSA-score": createOsvDetail({
            id: "GHSA-score",
            databaseSpecificSeverity: "LOW",
          }),
        },
      );

      const diagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          includeDevDependencies: false,
          failOn: "low",
        },
      });

      expect(diagnostics).toHaveLength(1);
      expect(stub.queryBatchRequests).toHaveLength(1);
      expect(stub.queryBatchRequests[0].map((query) => query.name)).toEqual(["scored-package"]);
      expect(stub.vulnerabilityRequests).toEqual(["GHSA-score"]);
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("fails open when OSV returns an error", async () => {
    const rootDirectory = createProjectDirectory();
    try {
      writePackageJson(rootDirectory, {
        dependencies: {
          "left-pad": "1.0.0",
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const requestUrl = String(input);
          if (requestUrl.endsWith("/v1/querybatch")) return new Response("error", { status: 500 });
          return new Response("not found", { status: 404 });
        }),
      );

      const diagnostics = await runCheckSupplyChain(rootDirectory, {
        supplyChain: {
          failOn: "low",
        },
      });

      expect(diagnostics).toEqual([]);
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("fails open when the whole check exceeds its timeout budget", async () => {
    const rootDirectory = createProjectDirectory();
    try {
      writePackageJson(rootDirectory, {
        dependencies: {
          "left-pad": "1.0.0",
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
