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

  it("fails open ([]) when sockets ignore the per-fetch abort and the whole-check budget elapses", async () => {
    writePackageJson({ "left-pad": "^1.3.0", "is-odd": "^3.0.0" });
    // Sockets that never tear down on abort: every fetch hangs forever, so
    // the per-fetch 10s timeout would otherwise keep the whole `forEach`
    // pending. The whole-check cap must short-circuit to "no artifacts".
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const diagnostics = await Effect.runPromise(
      checkSupplyChain({ rootDirectory: projectDirectory, userConfig: null, totalTimeoutMs: 20 }),
    );

    expect(diagnostics).toEqual([]);
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

  it("names the exact scored version for a `v`-prefixed pin instead of a range", async () => {
    writePackageJson({ "v-pinned": "v1.2.3" });
    stubSocketApi({
      "v-pinned": { supplyChain: 0.2, vulnerability: 1, maintenance: 1, quality: 1, license: 1 },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    // `v1.2.3` is an exact pin, so it must not be mislabeled as a range floor.
    expect(diagnostics[0].message).toContain("`v-pinned@1.2.3` scored");
    expect(diagnostics[0].message).not.toContain("lowest version");
  });

  // `semver.minVersion` throws (rather than returning null) on a dist-tag like
  // `latest`/`next`, and resolves a wildcard to a synthetic `0.0.0`. Each of
  // these specs has no concrete floor to score, so it must be skipped — never
  // crash the scan (issue #807) and never fetch a fabricated version.
  it.each([
    ["a dist-tag", "latest"],
    ["the `next` dist-tag", "next"],
    ["a bare wildcard", "*"],
    ["an `x` wildcard", "x"],
    ["a `workspace:` protocol", "workspace:*"],
    ["a `file:` protocol", "file:../local"],
    ["an `npm:` alias", "npm:other-pkg@1.2.3"],
    ["a git URL", "git+https://example.com/owner/repo.git"],
    ["a tarball URL", "https://example.com/pkg/foo-1.2.3.tgz"],
  ])("skips %s spec without crashing or scoring it", async (_label, spec) => {
    writePackageJson({ "unresolvable-pkg": spec });
    // Stub a failing score: if the spec were (mis)resolved to a concrete
    // version it would flag here. An empty result proves it was skipped.
    stubSocketApi({
      "unresolvable-pkg": {
        supplyChain: 0,
        vulnerability: 1,
        maintenance: 1,
        quality: 1,
        license: 1,
      },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("does not crash on a dist-tag and still scores resolvable siblings (issue #807, trigger.dev@latest)", async () => {
    // The exact regression shape: a real dep beside an npm dist-tag. PR #804
    // made this throw `TypeError: Invalid comparator: latest` on every scan.
    writePackageJson({ react: "^19.0.0", "trigger.dev": "latest" });
    stubSocketApi({
      react: { supplyChain: 0.2, vulnerability: 1, maintenance: 1, quality: 1, license: 1 },
      "trigger.dev": { supplyChain: 0, vulnerability: 1, maintenance: 1, quality: 1, license: 1 },
    });

    const diagnostics = await runCheck();
    // The dist-tag is skipped (not crashed on); the resolvable sibling still scores.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("`react@19.0.0");
  });

  it("keeps the score-driven diagnostic when alerts are malformed or null (no fail-open)", async () => {
    writePackageJson({ "null-alert-pkg": "1.0.0" });
    // A real Socket line where optional alert fields are explicitly `null`
    // (JSON APIs send `null`, not an absent key) and one alert is malformed
    // (missing `type`). Neither must sink the score that gates the check.
    const body = JSON.stringify({
      id: "test-artifact",
      type: "npm",
      score: {
        supplyChain: 0.1,
        vulnerability: 1,
        maintenance: 1,
        quality: 1,
        license: 1,
        overall: 0.1,
      },
      alerts: [
        { key: "a", type: "malware", severity: "critical", file: null, props: null },
        { key: "b", severity: "high" },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("scored 10/100 on Socket's supply chain axis");
    // The valid alert (with null fields) is still named; the malformed one is dropped.
    expect(diagnostics[0].message).toContain("critical known malware alert");
  });

  it("strips terminal escape sequences and backticks from remote alert strings", async () => {
    writePackageJson({ "ansi-pkg": "1.0.0" });
    stubSocketApi(
      { "ansi-pkg": { supplyChain: 0, vulnerability: 1, maintenance: 1, quality: 1, license: 1 } },
      {
        "ansi-pkg": [
          {
            type: "malware",
            severity: "critical",
            file: "pkg/\u001b[31mhidden\u001b[0m`whoami`.js",
            note: "Payload \u001b[2Kspoofs output and runs `rm -rf`.",
          },
        ],
      },
    );

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    const { message } = diagnostics[0];
    // No raw ESC reaches terminal-bound output, and backticks in remote strings
    // are neutralized so they can't break the `code` / "quote" framing.
    expect(message).not.toContain("\u001b");
    expect(message).toContain("pkg/[31mhidden[0m'whoami'.js");
    expect(message).toContain("Payload [2Kspoofs output and runs 'rm -rf'");
  });

  it("uses the axis remediation and gentler escape hatch for a non-critical alert", async () => {
    writePackageJson({ "high-not-critical": "1.0.0" });
    stubSocketApi(
      {
        "high-not-critical": {
          supplyChain: 0.1,
          vulnerability: 1,
          maintenance: 1,
          quality: 1,
          license: 1,
        },
      },
      {
        "high-not-critical": [
          { type: "obfuscatedCode", severity: "high", note: "Heavily obfuscated bundle." },
        ],
      },
    );

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("high obfuscated code alert");
    // A non-critical alert must not escalate to the "remove / do not ship" help.
    expect(diagnostics[0].help).not.toContain("do not ship it");
    expect(diagnostics[0].help).toContain("prefer a more established, audited alternative");
    expect(diagnostics[0].help).toContain("supplyChain.minScore");
  });

  it("summarizes multiple alerts with a +N more tail and the worst severity", async () => {
    writePackageJson({ "many-alerts": "1.0.0" });
    stubSocketApi(
      {
        "many-alerts": {
          supplyChain: 0.1,
          vulnerability: 1,
          maintenance: 1,
          quality: 1,
          license: 1,
        },
      },
      {
        "many-alerts": [
          { type: "malware", severity: "critical" },
          { type: "installScript", severity: "high" },
          { type: "networkAccess", severity: "medium" },
          { type: "envVars", severity: "low" },
        ],
      },
    );

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    // Four alerts: the top three are named, the remainder collapses to "+N more".
    expect(diagnostics[0].message).toContain("Socket flagged 4 alerts");
    expect(diagnostics[0].message).toContain("(+1 more)");
    expect(diagnostics[0].message).toContain("most severe: critical");
  });

  it('normalizes Socket\'s "middle" severity to "medium"', async () => {
    writePackageJson({ "middle-sev": "1.0.0" });
    stubSocketApi(
      {
        "middle-sev": {
          supplyChain: 0.1,
          vulnerability: 1,
          maintenance: 1,
          quality: 1,
          license: 1,
        },
      },
      { "middle-sev": [{ type: "troll", severity: "middle", note: "Protestware." }] },
    );

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("medium protestware alert");
  });
});
