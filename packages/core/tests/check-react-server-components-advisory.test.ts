import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { checkReactServerComponentsAdvisory, clearPackageJsonCache } from "@react-doctor/core";
import type { Diagnostic, PackageJson, ProjectInfo } from "@react-doctor/core";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rsc-advisory-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

let directoryCounter = 0;
const makeProjectDirectory = (): string => {
  const projectDirectory = path.join(tempRoot, `project-${directoryCounter++}`);
  fs.mkdirSync(projectDirectory, { recursive: true });
  return projectDirectory;
};

const RULE_KEY = "no-vulnerable-react-server-components";

interface FixtureInput {
  readonly packageJson?: PackageJson;
  /** Installed `node_modules/<name>/package.json` versions to materialize. */
  readonly installed?: Record<string, string>;
  readonly framework?: ProjectInfo["framework"];
  readonly nextjsVersion?: string | null;
}

const buildProject = (
  rootDirectory: string,
  framework: ProjectInfo["framework"],
  nextjsVersion: string | null,
): ProjectInfo => ({
  rootDirectory,
  projectName: "fixture-app",
  reactVersion: "19.2.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework,
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 10,
});

const setupFixture = (input: FixtureInput): { directory: string; project: ProjectInfo } => {
  const directory = makeProjectDirectory();
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify(input.packageJson ?? { name: "fixture-app" }, null, 2),
  );
  for (const [packageName, version] of Object.entries(input.installed ?? {})) {
    const manifestDirectory = path.join(directory, "node_modules", packageName);
    fs.mkdirSync(manifestDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(manifestDirectory, "package.json"),
      JSON.stringify({ name: packageName, version }),
    );
  }
  clearPackageJsonCache();
  return {
    directory,
    project: buildProject(directory, input.framework ?? "vite", input.nextjsVersion ?? null),
  };
};

const run = (input: FixtureInput): Diagnostic[] => {
  const { directory, project } = setupFixture(input);
  return checkReactServerComponentsAdvisory(directory, project);
};

const expectAdvisoryShape = (diagnostic: Diagnostic): void => {
  expect(diagnostic.rule).toBe(RULE_KEY);
  expect(diagnostic.plugin).toBe("react-doctor");
  expect(diagnostic.category).toBe("Security");
  expect(diagnostic.filePath).toBe("package.json");
  expect(diagnostic.message.length).toBeGreaterThan(0);
  expect(diagnostic.help.length).toBeGreaterThan(0);
};

describe("checkReactServerComponentsAdvisory — react-server-dom packages (non-Next)", () => {
  it("flags the critical RCE on a vulnerable installed react-server-dom-webpack", () => {
    const diagnostics = run({ installed: { "react-server-dom-webpack": "19.2.0" } });
    expect(diagnostics).toHaveLength(1);
    expectAdvisoryShape(diagnostics[0]);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("CVE-2025-55182");
    expect(diagnostics[0].message).toContain("remote code execution");
    expect(diagnostics[0].help).toContain("19.2.6");
  });

  it("flags each affected minor line at its own RCE-fixed boundary", () => {
    expect(run({ installed: { "react-server-dom-webpack": "19.0.0" } })[0].severity).toBe("error");
    expect(run({ installed: { "react-server-dom-webpack": "19.1.1" } })[0].severity).toBe("error");
    expect(run({ installed: { "react-server-dom-webpack": "19.2.0" } })[0].severity).toBe("error");
  });

  it("downgrades to a DoS warning between the RCE fix and the latest safe release", () => {
    const diagnostics = run({ installed: { "react-server-dom-webpack": "19.2.3" } });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain("CVE-2026-23870");
    expect(diagnostics[0].message).toContain("denial-of-service");
    expect(diagnostics[0].help).toContain("19.2.6");
  });

  it("stays quiet once the line is fully patched", () => {
    expect(run({ installed: { "react-server-dom-webpack": "19.2.6" } })).toEqual([]);
    expect(run({ installed: { "react-server-dom-webpack": "19.1.7" } })).toEqual([]);
    expect(run({ installed: { "react-server-dom-webpack": "19.0.6" } })).toEqual([]);
    expect(run({ installed: { "react-server-dom-webpack": "19.2.10" } })).toEqual([]);
  });

  it("checks the parcel and turbopack transports too", () => {
    expect(run({ installed: { "react-server-dom-parcel": "19.1.0" } })[0].severity).toBe("error");
    expect(run({ installed: { "react-server-dom-turbopack": "19.2.0" } })[0].severity).toBe(
      "error",
    );
  });

  it("treats a canary of a vulnerable line as still vulnerable", () => {
    const diagnostics = run({ installed: { "react-server-dom-webpack": "19.2.0-canary.77" } });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("ignores unaffected major/minor lines (no RSC RCE on React 18 or future 19.3)", () => {
    expect(run({ installed: { "react-server-dom-webpack": "18.3.1" } })).toEqual([]);
    expect(run({ installed: { "react-server-dom-webpack": "19.3.0" } })).toEqual([]);
  });

  it("falls back to an exact pin declared in package.json when node_modules is absent", () => {
    const diagnostics = run({
      packageJson: {
        name: "fixture-app",
        dependencies: { "react-server-dom-webpack": "19.2.0" },
      },
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("does NOT flag off an ambiguous declared range (lockfile may resolve higher)", () => {
    expect(
      run({
        packageJson: {
          name: "fixture-app",
          dependencies: { "react-server-dom-webpack": "^19.2.0" },
        },
      }),
    ).toEqual([]);
  });

  it("prefers the concrete installed version over the declared range", () => {
    const diagnostics = run({
      packageJson: {
        name: "fixture-app",
        dependencies: { "react-server-dom-webpack": "^19.2.0" },
      },
      installed: { "react-server-dom-webpack": "19.2.0" },
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("stays quiet for a pure client-side React app with no RSC packages", () => {
    expect(
      run({ packageJson: { name: "fixture-app", dependencies: { react: "19.2.0" } } }),
    ).toEqual([]);
  });
});

describe("checkReactServerComponentsAdvisory — Next.js special plumbing", () => {
  const runNext = (version: string | null, installed?: Record<string, string>): Diagnostic[] =>
    run({
      framework: "nextjs",
      nextjsVersion: version,
      installed: installed ?? (version === null ? {} : { next: version }),
      packageJson: { name: "fixture-app", dependencies: { next: version ?? "latest" } },
    });

  it("flags the critical RCE on a vulnerable Next.js 15.x and points the fix at Next.js, not React", () => {
    const diagnostics = runNext("15.0.0");
    expect(diagnostics).toHaveLength(1);
    expectAdvisoryShape(diagnostics[0]);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("CVE-2025-55182");
    expect(diagnostics[0].help).toContain("next@15.5.18");
    expect(diagnostics[0].help.toLowerCase()).toContain("bundles its own");
  });

  it("uses each 15.x minor's own RCE-fixed boundary", () => {
    expect(runNext("15.1.0")[0].severity).toBe("error");
    expect(runNext("15.4.7")[0].severity).toBe("error");
    expect(runNext("16.0.0")[0].severity).toBe("error");
  });

  it("downgrades to a DoS warning once the RCE is patched but the line is not fully safe", () => {
    const diagnostics = runNext("15.5.7");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain("CVE-2026-23870");
    expect(diagnostics[0].help).toContain("next@15.5.18");
  });

  it("warns on a partly-patched Next.js 16.x minor that postdates the RCE", () => {
    const diagnostics = runNext("16.2.0");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].help).toContain("next@16.2.6");
  });

  it("stays quiet on a fully patched Next.js", () => {
    expect(runNext("15.5.18")).toEqual([]);
    expect(runNext("16.2.6")).toEqual([]);
    expect(runNext("15.5.20")).toEqual([]);
  });

  it("warns that unsupported 13.x / 14.x lines must move majors", () => {
    for (const version of ["14.2.0", "13.5.0"]) {
      const diagnostics = runNext(version);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe("warning");
      expect(diagnostics[0].help).toContain("15.5.18 or 16.2.6");
    }
  });

  it("ignores pre-RSC Next.js (12.x) and unknown future majors (17.x)", () => {
    expect(runNext("12.3.4")).toEqual([]);
    expect(runNext("17.0.0")).toEqual([]);
  });

  it("checks Next.js by its own version even when a standalone react-server-dom is also present", () => {
    const diagnostics = runNext("15.5.18", {
      next: "15.5.18",
      "react-server-dom-webpack": "19.2.0",
    });
    expect(diagnostics).toEqual([]);
  });

  it("stays quiet when the Next.js version cannot be resolved (range only, no node_modules)", () => {
    expect(runNext(null)).toEqual([]);
  });
});
