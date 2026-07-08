import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { checkSupplyChain } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

interface AxisScores {
  readonly supplyChain: number;
  readonly vulnerability: number;
  readonly maintenance: number;
  readonly quality: number;
  readonly license: number;
}

const HEALTHY_CONTEXT = { maintenance: 1, quality: 1, license: 1 };

const socketArtifactLine = (axes: AxisScores): string =>
  JSON.stringify({
    id: "test-artifact",
    type: "npm",
    score: { ...axes, overall: Math.min(...Object.values(axes)) },
    alerts: [],
  });

// Keyed by exact `name@version`, so a test can prove WHICH concrete version
// was scored (floor vs lockfile resolution), not just which package.
const stubSocketApiByExactVersion = (scoresByNameAtVersion: Record<string, AxisScores>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = decodeURIComponent(String(input));
      const matched = Object.entries(scoresByNameAtVersion).find(([nameAtVersion]) =>
        requestUrl.endsWith(`pkg:npm/${nameAtVersion}`),
      );
      const body = matched ? socketArtifactLine(matched[1]) : "";
      return new Response(body, { status: 200 });
    }),
  );
};

let projectDirectory: string;

const writeManifest = (manifest: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): void => {
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "1.0.0", ...manifest }, null, 2)}\n`,
  );
};

const runCheck = async (): Promise<Diagnostic[]> =>
  Effect.runPromise(checkSupplyChain({ rootDirectory: projectDirectory, userConfig: null }));

describe("checkSupplyChain — regressions", () => {
  beforeEach(() => {
    projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-supply-chain-reg-"));
    vi.stubEnv("REACT_DOCTOR_NO_CACHE", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(projectDirectory, { recursive: true, force: true });
  });

  it("scores the yarn.lock resolution instead of the range floor (mapguide jspdf shape)", async () => {
    writeManifest({ dependencies: { jspdf: "^4.0.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "yarn.lock"),
      `"jspdf@npm:^4.0.0":\n  version: 4.2.1\n  resolution: "jspdf@npm:4.2.1"\n`,
    );
    stubSocketApiByExactVersion({
      "jspdf@4.0.0": { supplyChain: 1, vulnerability: 0.2, ...HEALTHY_CONTEXT },
      "jspdf@4.2.1": { supplyChain: 1, vulnerability: 1, ...HEALTHY_CONTEXT },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("scores the classic yarn.lock (v1) resolution instead of the range floor", async () => {
    writeManifest({ dependencies: { jspdf: "^4.0.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "yarn.lock"),
      `# yarn lockfile v1\n\n\njspdf@^4.0.0:\n  version "4.2.1"\n  resolved "https://registry.yarnpkg.com/jspdf/-/jspdf-4.2.1.tgz"\n`,
    );
    stubSocketApiByExactVersion({
      "jspdf@4.0.0": { supplyChain: 1, vulnerability: 0.2, ...HEALTHY_CONTEXT },
      "jspdf@4.2.1": { supplyChain: 1, vulnerability: 1, ...HEALTHY_CONTEXT },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("resolves through a berry yarn.lock header naming several descriptors", async () => {
    writeManifest({ dependencies: { jspdf: "^4.0.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "yarn.lock"),
      `"jspdf@npm:^3.0.0, jspdf@npm:^4.0.0":\n  version: 4.2.1\n  resolution: "jspdf@npm:4.2.1"\n`,
    );
    stubSocketApiByExactVersion({
      "jspdf@4.0.0": { supplyChain: 1, vulnerability: 0.2, ...HEALTHY_CONTEXT },
      "jspdf@4.2.1": { supplyChain: 1, vulnerability: 1, ...HEALTHY_CONTEXT },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("scores the package-lock.json resolution instead of the range floor (psysonic ^2 shape)", async () => {
    writeManifest({ dependencies: { "@tauri-apps/plugin-shell": "^2" } });
    fs.writeFileSync(
      path.join(projectDirectory, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/@tauri-apps/plugin-shell": { version: "2.3.5" } },
      }),
    );
    stubSocketApiByExactVersion({
      "@tauri-apps/plugin-shell@2.0.0": { supplyChain: 1, vulnerability: 0.1, ...HEALTHY_CONTEXT },
      "@tauri-apps/plugin-shell@2.3.5": { supplyChain: 1, vulnerability: 1, ...HEALTHY_CONTEXT },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("scores the pnpm-lock.yaml importer resolution instead of the range floor", async () => {
    writeManifest({ dependencies: { "left-pad": "^1.0.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "pnpm-lock.yaml"),
      `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      left-pad:\n        specifier: ^1.0.0\n        version: 1.3.0\n`,
    );
    stubSocketApiByExactVersion({
      "left-pad@1.0.0": { supplyChain: 1, vulnerability: 0.1, ...HEALTHY_CONTEXT },
      "left-pad@1.3.0": { supplyChain: 1, vulnerability: 1, ...HEALTHY_CONTEXT },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("still flags when the lockfile resolution itself scores below the minimum, naming the locked version", async () => {
    writeManifest({ dependencies: { "event-stream": "^3.3.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/event-stream": { version: "3.3.6" } },
      }),
    );
    stubSocketApiByExactVersion({
      "event-stream@3.3.6": { supplyChain: 1, vulnerability: 0.25, ...HEALTHY_CONTEXT },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain(
      '`event-stream@3.3.6 (lockfile resolution of "^3.3.0")`',
    );
  });

  it("falls back to the range floor when the lockfile entry does not satisfy the declared spec", async () => {
    writeManifest({ dependencies: { "ranged-pkg": "^2.0.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/ranged-pkg": { version: "1.9.0" } },
      }),
    );
    stubSocketApiByExactVersion({
      "ranged-pkg@2.0.0": { supplyChain: 0.2, vulnerability: 1, ...HEALTHY_CONTEXT },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('`ranged-pkg@2.0.0 (lowest version "^2.0.0" allows)`');
  });

  it("does not gate the vulnerability axis for devDependencies (vitest dev-server advisory shape)", async () => {
    writeManifest({ devDependencies: { vitest: "4.0.18" } });
    stubSocketApiByExactVersion({
      "vitest@4.0.18": { supplyChain: 1, vulnerability: 0.2, ...HEALTHY_CONTEXT },
    });

    expect(await runCheck()).toEqual([]);
  });

  it("keeps gating the supply-chain axis for devDependencies (malicious dev tool still executes locally)", async () => {
    writeManifest({ devDependencies: { "evil-dev-tool": "1.0.0" } });
    stubSocketApiByExactVersion({
      "evil-dev-tool@1.0.0": { supplyChain: 0.1, vulnerability: 1, ...HEALTHY_CONTEXT },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("scored 10/100 on Socket's supply chain axis");
  });

  it("keeps gating the vulnerability axis for production dependencies", async () => {
    writeManifest({ dependencies: { "vulnerable-prod": "1.0.0" } });
    stubSocketApiByExactVersion({
      "vulnerable-prod@1.0.0": { supplyChain: 1, vulnerability: 0.2, ...HEALTHY_CONTEXT },
    });

    const diagnostics = await runCheck();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("scored 20/100 on Socket's vulnerability axis");
  });
});
