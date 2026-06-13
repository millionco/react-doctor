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

const socketArtifactLine = (axes: AxisScores): string =>
  JSON.stringify({
    id: "test-artifact",
    type: "npm",
    score: { ...axes, overall: Math.min(...Object.values(axes)) },
  });

// Stubs the free Socket PURL endpoint with one canned artifact per package
// name (the NDJSON body shape the real endpoint streams).
const stubSocketApi = (scoresByPackageName: Record<string, AxisScores>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = decodeURIComponent(String(input));
      const matched = Object.entries(scoresByPackageName).find(([name]) =>
        requestUrl.includes(`pkg:npm/${name}@`),
      );
      const body = matched ? socketArtifactLine(matched[1]) : "";
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
    expect(diagnostics[0].message).toContain("has a Socket vulnerability score of 25/100");
    expect(diagnostics[0].message).not.toContain("supply chain score of 25");
    // The full axis breakdown stays in the message as context.
    expect(diagnostics[0].message).toContain("supply chain 100, vulnerability 25");
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
    expect(diagnostics[0].message).toContain("has a Socket supply chain score of 20/100");
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
    expect(diagnostics[0].message).toContain("has a Socket vulnerability score of 10/100");
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
});
