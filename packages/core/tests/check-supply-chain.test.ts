import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { checkSupplyChain } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

// Per-axis Socket scores in the API's normalized 0..1 range. `overall` is
// Socket's lowest axis, mirroring how the real endpoint computes it.
interface AxisScores {
  readonly supplyChain: number;
  readonly vulnerability: number;
  readonly maintenance: number;
  readonly quality: number;
  readonly license: number;
}

// A Socket alert in the shape the endpoint attaches to high-signal threats:
// the `note` rides `props.note`, mirroring the real artifact.
interface AlertInput {
  readonly type: string;
  readonly severity: string;
  readonly category?: string;
  readonly file?: string;
  readonly note?: string;
}

const socketArtifactLine = (axes: AxisScores, alerts: ReadonlyArray<AlertInput>): string =>
  JSON.stringify({
    id: "test-artifact",
    type: "npm",
    score: { ...axes, overall: Math.min(...Object.values(axes)) },
    alerts: alerts.map((alert) => ({
      key: `${alert.type}-key`,
      type: alert.type,
      severity: alert.severity,
      category: alert.category ?? "supplyChainRisk",
      ...(alert.file ? { file: alert.file } : {}),
      ...(alert.note ? { props: { note: alert.note } } : {}),
    })),
  });

// Stubs the free Socket PURL endpoint with one canned artifact per package
// name (the NDJSON body shape the real endpoint streams). Alerts are optional
// — the free endpoint omits them for metric-driven (CVE-only) low scores.
const stubSocketApi = (
  scoresByPackageName: Record<string, AxisScores>,
  alertsByPackageName: Record<string, ReadonlyArray<AlertInput>> = {},
): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = decodeURIComponent(String(input));
      const matched = Object.entries(scoresByPackageName).find(([name]) =>
        requestUrl.includes(`pkg:npm/${name}@`),
      );
      const body = matched
        ? socketArtifactLine(matched[1], alertsByPackageName[matched[0]] ?? [])
        : "";
      return new Response(body, { status: 200 });
    }),
  );
};

let projectDirectory: string;

const writePackageJson = (dependencies: Record<string, string>): void => {
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "1.0.0", dependencies }, null, 2)}\n`,
  );
};

const runCheck = async (): Promise<Diagnostic[]> =>
  Effect.runPromise(checkSupplyChain({ rootDirectory: projectDirectory, userConfig: null }));

describe("checkSupplyChain — security-axis gating", () => {
  beforeEach(() => {
    projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-supply-chain-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(projectDirectory, { recursive: true, force: true });
  });

  it("does not flag a package whose security axes are healthy but quality drags `overall` below the minimum (issue #770, @types/bun)", async () => {
    writePackageJson({ "@types/bun": "^1.3.14" });
    stubSocketApi({
      "@types/bun": {
        supplyChain: 1,
        vulnerability: 1,
        maintenance: 0.92,
        quality: 0.48,
        license: 1,
      },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("flags a vulnerability-driven low score and names the vulnerability axis (event-stream@3.3.6 shape)", async () => {
    writePackageJson({ "event-stream": "3.3.6" });
    stubSocketApi({
      "event-stream": {
        supplyChain: 1,
        vulnerability: 0.25,
        maintenance: 1,
        quality: 1,
        license: 1,
      },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].rule).toBe("low-supply-chain-score");
    expect(diagnostics[0].message).toContain("scored 25/100 on Socket's vulnerability axis");
    expect(diagnostics[0].message).not.toContain("supply chain axis");
    // With no alerts, the message explains what the failing axis means.
    expect(diagnostics[0].message).toContain("known security vulnerabilities (CVEs)");
    // The remaining axes follow as context (the failing one already leads).
    expect(diagnostics[0].message).toContain("Other axes — supply chain 100, maintenance 100");
    // Vulnerability remediation is "upgrade", not the generic "update/replace".
    expect(diagnostics[0].help).toContain("npm audit");
  });

  it("flags a supplyChain-driven low score and names the supply chain axis", async () => {
    writePackageJson({ "evil-typosquat": "1.0.0" });
    stubSocketApi({
      "evil-typosquat": {
        supplyChain: 0.2,
        vulnerability: 1,
        maintenance: 1,
        quality: 1,
        license: 1,
      },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("scored 20/100 on Socket's supply chain axis");
  });

  it("headlines the worst security axis when both gate below the minimum", async () => {
    writePackageJson({ "doubly-bad": "2.0.0" });
    stubSocketApi({
      "doubly-bad": {
        supplyChain: 0.4,
        vulnerability: 0.1,
        maintenance: 1,
        quality: 1,
        license: 1,
      },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("scored 10/100 on Socket's vulnerability axis");
  });

  it("does not flag a security axis exactly at the minimum score", async () => {
    writePackageJson({ "borderline-pkg": "1.0.0" });
    stubSocketApi({
      "borderline-pkg": {
        supplyChain: 0.5,
        vulnerability: 1,
        maintenance: 0.1,
        quality: 0.1,
        license: 0.1,
      },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("names Socket's concrete alert and tells you to remove a malware package", async () => {
    writePackageJson({ "evil-pkg": "1.0.0" });
    stubSocketApi(
      {
        "evil-pkg": { supplyChain: 0, vulnerability: 1, maintenance: 1, quality: 1, license: 1 },
      },
      {
        "evil-pkg": [
          {
            type: "malware",
            severity: "critical",
            file: "package/index.js",
            note: "Concealed remote-code-execution payload that exfiltrates environment variables.",
          },
        ],
      },
    );

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    // The message names the alert, the offending file, and the note instead of
    // leaving the user to guess what a "0/100" means.
    expect(diagnostics[0].message).toContain("scored 0/100 on Socket's supply chain axis");
    expect(diagnostics[0].message).toContain("critical known malware alert");
    expect(diagnostics[0].message).toContain("`package/index.js`");
    expect(diagnostics[0].message).toContain(
      "Concealed remote-code-execution payload that exfiltrates environment variables",
    );
    // A critical alert escalates the help from "update/replace" to "remove".
    expect(diagnostics[0].help).toContain("do not ship it");
    expect(diagnostics[0].help).toContain("Remove");
    expect(diagnostics[0].help).toContain("supplyChain.enabled: false");
  });

  it("names the scored version as the floor of a range spec", async () => {
    writePackageJson({ "ranged-pkg": "^2.1.0" });
    stubSocketApi({
      "ranged-pkg": { supplyChain: 0.2, vulnerability: 1, maintenance: 1, quality: 1, license: 1 },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('`ranged-pkg@2.1.0 (lowest version "^2.1.0" allows)`');
  });
});
