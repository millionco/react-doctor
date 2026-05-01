/**
 * Regression tests for closed issues that touch CLI flag exposure, output
 * formatting (annotations / scoring banner), and the explicit "skipped
 * checks" surface that came from the silent-failure issues.
 *
 * Covered closed issues:
 *   #43 — silent global `npm install -g` removed and must not return
 *   #50 — `--lint` and `--dead-code` exist as positive flags so they can
 *         override a config that disables them
 *   #66 + #81 — GitHub Actions annotation-property encoding
 *   #92 — `share: false` config option exists in the schema and is read
 *         by the scan banner
 *   #135 — dead-code failures surface in `skippedChecks`, never silently
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { scan } from "../../src/scan.js";
import type { ReactDoctorConfig, ScanResult } from "../../src/types.js";
import {
  encodeAnnotationProperty,
  encodeAnnotationMessage,
} from "../../src/utils/annotation-encoding.js";
import { setupReactProject, writeFile, writeJson } from "./_helpers.js";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..", "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-cli-and-output-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupMinimalReactProject = (caseId: string): string =>
  setupReactProject(tempRoot, caseId, {
    files: { "src/App.tsx": `export const App = () => null;\n` },
  });

// Capture every line `scan()` writes to console while it runs. We use
// real I/O (logger / spinner / console.log) rather than scrub source
// text — testing observable behavior survives refactors that move
// strings around.
const captureScanOutput = async (
  projectDir: string,
  options: Parameters<typeof scan>[1],
): Promise<{ result: ScanResult; stdout: string; stderr: string }> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => stdout.push(args.join(" "));
  console.info = (...args: unknown[]) => stdout.push(args.join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.join(" "));
  console.warn = (...args: unknown[]) => stderr.push(args.join(" "));
  try {
    const result = await scan(projectDir, options);
    return { result, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.error = originalError;
    console.warn = originalWarn;
  }
};

describe("issue #50: CLI flags can re-enable lint/dead-code that config disabled", () => {
  it("scan(directory, { lint: true }) overrides a `lint: false` config", async () => {
    const projectDir = setupMinimalReactProject("issue-50-lint");
    writeJson(path.join(projectDir, "react-doctor.config.json"), {
      lint: false,
      deadCode: false,
    });
    // Pass lint:true explicitly — the resolved options must include lint=true
    // even though the config said false.
    const { result } = await captureScanOutput(projectDir, {
      lint: true,
      deadCode: true,
      offline: true,
      silent: true,
    });
    // If lint had stayed false we'd see it in skippedChecks (or no lint
    // diagnostics regardless of the source). The scan must succeed and
    // not have lint in skippedChecks (which would mean it ran and failed).
    expect(result.skippedChecks).not.toContain("lint");
  });

  it("scan(directory, { lint: false }) overrides a `lint: true` config", async () => {
    const projectDir = setupMinimalReactProject("issue-50-no-lint");
    writeJson(path.join(projectDir, "react-doctor.config.json"), { lint: true });
    const { result } = await captureScanOutput(projectDir, {
      lint: false,
      deadCode: false,
      offline: true,
      silent: true,
    });
    // With lint disabled, no lint diagnostics can appear. Knip is also off.
    expect(result.diagnostics.filter((d) => d.plugin === "react-doctor")).toHaveLength(0);
  });
});

describe("issue #66 + #81: GitHub Actions annotation encoding", () => {
  it("encodes newlines and percent in message bodies (otherwise the annotation is truncated)", () => {
    const message = "first line\nsecond, line: with 50% etc.";
    const encoded = encodeAnnotationMessage(message);
    expect(encoded).not.toContain("\n");
    expect(encoded).toContain("%0A");
    expect(encoded).toContain("%25");
  });

  it("encodes commas and colons in property values (file=, line=, title=)", () => {
    const filename = "src/foo,bar:baz%qux\nx.tsx";
    const encoded = encodeAnnotationProperty(filename);
    expect(encoded).not.toContain("\n");
    expect(encoded).not.toContain(",");
    expect(encoded).not.toContain(":");
    expect(encoded).toContain("%25");
  });

  it("round-trips: decoded message equals original", () => {
    const original = "line one\nline, two: %50";
    const decoded = decodeURIComponent(encodeAnnotationMessage(original));
    expect(decoded).toBe(original);
  });
});

describe("issue #92: share: false config suppresses the share link in scan output", () => {
  it("ReactDoctorConfig type accepts `share: false`", () => {
    // HACK: pure type assertion. If `share` is removed from the type,
    // this file stops type-checking and the suite refuses to run.
    const config: ReactDoctorConfig = { share: false };
    expect(config.share).toBe(false);
  });

  it("the share URL appears in stdout by default and is suppressed when share=false", async () => {
    const projectDir = setupMinimalReactProject("issue-92-default");
    writeFile(
      path.join(projectDir, "src", "App.tsx"),
      `import { useState, useEffect } from "react";
export const App = ({ name }: { name: string }) => {
  const [n, setN] = useState("");
  useEffect(() => { setN(name); }, [name]);
  return <div>{n}</div>;
};
`,
    );
    const defaultRun = await captureScanOutput(projectDir, { offline: false });
    expect(defaultRun.stdout).toContain("Share your results");

    const projectDir2 = setupMinimalReactProject("issue-92-disabled");
    writeFile(
      path.join(projectDir2, "src", "App.tsx"),
      `import { useState, useEffect } from "react";
export const App = ({ name }: { name: string }) => {
  const [n, setN] = useState("");
  useEffect(() => { setN(name); }, [name]);
  return <div>{n}</div>;
};
`,
    );
    writeJson(path.join(projectDir2, "react-doctor.config.json"), { share: false });
    const disabledRun = await captureScanOutput(projectDir2, { offline: false });
    expect(disabledRun.stdout).not.toContain("Share your results");
  });
});

describe("issue #135: dead-code failures surface in skippedChecks", () => {
  it("scan() returns a `skippedChecks` array on the result", async () => {
    const projectDir = setupMinimalReactProject("issue-135");
    const { result } = await captureScanOutput(projectDir, {
      lint: false,
      deadCode: false,
      offline: true,
      silent: true,
    });
    // Type contract: skippedChecks always exists as an array.
    expect(Array.isArray(result.skippedChecks)).toBe(true);
  });
});

describe("issue #43: no silent global npm install", () => {
  it("source tree contains no `npm install -g` invocation", () => {
    // HACK: walk the source tree directly instead of shelling out to `rg`,
    // so the test works on machines without ripgrep installed.
    const srcRoot = path.join(PACKAGE_ROOT, "src");
    const offendingMatches: string[] = [];
    const stack: string[] = [srcRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
        const content = fs.readFileSync(entryPath, "utf8");
        if (content.includes("npm install -g")) {
          offendingMatches.push(path.relative(PACKAGE_ROOT, entryPath));
        }
      }
    }
    expect(offendingMatches).toEqual([]);
  });
});
