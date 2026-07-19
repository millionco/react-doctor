import { describe, expect, it } from "vite-plus/test";
import { buildJsonReport } from "@react-doctor/core";
import type { Diagnostic, InspectResult, ProjectInfo } from "@react-doctor/core";

const projectInfo: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "app",
  reactVersion: "18.3.1",
  reactMajorVersion: 18,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  preactVersion: null,
  preactMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  sourceFileCount: 50,
};

const errorDiagnostic: Diagnostic = {
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "error",
  message: "Array index used as React key",
  help: "",
  line: 12,
  column: 1,
  category: "Correctness",
};

const result = (overrides: Partial<InspectResult> = {}): InspectResult => ({
  diagnostics: [errorDiagnostic],
  score: { score: 88, label: "Good" },
  skippedChecks: [],
  analyzedFiles: ["src/App.tsx"],
  project: projectInfo,
  elapsedMilliseconds: 1000,
  scannedFileCount: 1,
  ...overrides,
});

describe("buildJsonReport", () => {
  it("emits a v3 report with deterministic diagnostic identity and exact coverage", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "diff",
      diff: null,
      scans: [
        {
          directory: "/repo",
          result: result({
            diagnostics: [{ ...errorDiagnostic, filePath: "/repo/src/../src/App.tsx" }],
          }),
        },
      ],
      totalElapsedMilliseconds: 1200,
    });
    expect(report.schemaVersion).toBe(3);
    expect(report.mode).toBe("diff");
    expect("baseline" in report).toBe(false);
    expect("baselineDegraded" in report).toBe(false);
    expect(report.projects[0]).toMatchObject({
      packageRoot: "/repo",
      framework: "nextjs",
      analyzedFiles: ["src/App.tsx"],
      analyzedFileCount: 1,
      complete: true,
    });
    expect(report.diagnostics[0]).toMatchObject({
      id: expect.stringMatching(
        /^src\/App\.tsx::12:1::react-doctor\/no-array-index-as-key::[a-f0-9]{64}$/,
      ),
      normalizedFilePath: "src/App.tsx",
      filePath: "/repo/src/../src/App.tsx",
      plugin: "react-doctor",
      rule: "no-array-index-as-key",
      category: "Correctness",
      severity: "error",
    });
    expect(report.diagnostics[0].tags).toEqual([...report.diagnostics[0].tags].sort());
    expect(report.diagnostics[0]).not.toHaveProperty("ruleId");
    expect(report.diagnostics[0]).not.toHaveProperty("location");
  });

  it("assigns distinct occurrence identities to same-site findings from one rule", () => {
    const cleanupMessage =
      "Your cleanup may read the wrong node since the ref `sidebarRef.current` can change before it runs.";
    const loopMessage =
      "`useEffect` calls `setMobile` with no dependency array, so it can loop forever & freeze the component.";
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [
        {
          directory: "/repo",
          result: result({
            diagnostics: [
              {
                ...errorDiagnostic,
                filePath: "src/components/sidebar/CSidebar.tsx",
                rule: "exhaustive-deps",
                severity: "warning",
                message: cleanupMessage,
                line: 122,
                column: 15,
              },
              {
                ...errorDiagnostic,
                filePath: "src/components/sidebar/CSidebar.tsx",
                rule: "exhaustive-deps",
                severity: "warning",
                message: loopMessage,
                line: 122,
                column: 15,
              },
            ],
          }),
        },
      ],
      totalElapsedMilliseconds: 1200,
    });

    expect(report.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      cleanupMessage,
      loopMessage,
    ]);
    expect(new Set(report.diagnostics.map((diagnostic) => diagnostic.id)).size).toBe(2);
  });

  it("scopes diagnostic identities and affected file counts to workspace projects", () => {
    const firstProject = {
      ...projectInfo,
      rootDirectory: "/repo/packages/first",
      projectName: "first",
    };
    const secondProject = {
      ...projectInfo,
      rootDirectory: "/repo/packages/second",
      projectName: "second",
    };
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [
        {
          directory: firstProject.rootDirectory,
          result: result({ project: firstProject }),
        },
        {
          directory: secondProject.rootDirectory,
          result: result({ project: secondProject }),
        },
      ],
      totalElapsedMilliseconds: 1200,
    });

    expect(report.diagnostics.map((diagnostic) => diagnostic.normalizedFilePath)).toEqual([
      "src/App.tsx",
      "src/App.tsx",
    ]);
    expect(report.diagnostics.map((diagnostic) => diagnostic.id)).toEqual([
      expect.stringMatching(
        /^packages\/first\/src\/App\.tsx::12:1::react-doctor\/no-array-index-as-key::[a-f0-9]{64}$/,
      ),
      expect.stringMatching(
        /^packages\/second\/src\/App\.tsx::12:1::react-doctor\/no-array-index-as-key::[a-f0-9]{64}$/,
      ),
    ]);
    expect(new Set(report.diagnostics.map((diagnostic) => diagnostic.id)).size).toBe(2);
    expect(report.summary.affectedFileCount).toBe(2);
  });

  it("marks a v3 report baselineDegraded when a compare run couldn't diff the base", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "diff",
      diff: null,
      scans: [{ directory: "/repo", result: result() }],
      totalElapsedMilliseconds: 1200,
      baselineDegraded: true,
    });
    expect(report.schemaVersion).toBe(3);
    expect(report.mode).toBe("diff");
    expect(report.baselineDegraded).toBe(true);
  });

  it("sorts and deduplicates analyzed files and marks partial coverage incomplete", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [
        {
          directory: "/repo",
          result: result({
            analyzedFiles: ["src/B.tsx", "src\\A.tsx", "src/B.tsx"],
            scannedFileCount: 3,
          }),
        },
      ],
      totalElapsedMilliseconds: 1200,
    });
    expect(report.projects[0].analyzedFiles).toEqual(["src/A.tsx", "src/B.tsx"]);
    expect(report.projects[0].analyzedFileCount).toBe(2);
    expect(report.projects[0].complete).toBe(false);
  });

  it("marks a fully analyzed project incomplete when a partial check reason exists", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [
        {
          directory: "/repo",
          result: result({
            skippedCheckReasons: {
              "lint:partial": "React Hooks rules were skipped after their plugin failed to load.",
            },
          }),
        },
      ],
      totalElapsedMilliseconds: 1200,
    });
    expect(report.projects[0].analyzedFileCount).toBe(report.projects[0].scannedFileCount);
    expect(report.projects[0].skippedChecks).toEqual([]);
    expect(report.projects[0].complete).toBe(false);
  });

  it("marks reactDetected true on a scan that resolved a React runtime", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [{ directory: "/repo", result: result() }],
      totalElapsedMilliseconds: 1200,
    });
    expect(report.reactDetected).toBe(true);
  });

  it("marks reactDetected false when no scanned project resolved React or Preact", () => {
    const nonReactProject: ProjectInfo = {
      ...projectInfo,
      reactVersion: null,
      reactMajorVersion: null,
      preactVersion: null,
      preactMajorVersion: null,
      framework: "unknown",
    };
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [
        { directory: "/repo", result: result({ diagnostics: [], project: nonReactProject }) },
      ],
      totalElapsedMilliseconds: 1200,
    });
    expect(report.reactDetected).toBe(false);
    expect(report.ok).toBe(true);
    expect(report.diagnostics).toHaveLength(0);
  });

  it("marks reactDetected true in a workspace where only some roots are React", () => {
    const nonReactProject: ProjectInfo = {
      ...projectInfo,
      rootDirectory: "/repo/packages/tooling",
      reactVersion: null,
      reactMajorVersion: null,
      framework: "unknown",
    };
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [
        {
          directory: "/repo/packages/tooling",
          result: result({ diagnostics: [], project: nonReactProject }),
        },
        { directory: "/repo/packages/app", result: result() },
      ],
      totalElapsedMilliseconds: 1200,
    });
    expect(report.reactDetected).toBe(true);
  });

  it("marks reactDetected true when a Preact runtime satisfies the react capability", () => {
    const preactProject: ProjectInfo = {
      ...projectInfo,
      reactVersion: null,
      reactMajorVersion: null,
      preactVersion: "10.19.2",
      preactMajorVersion: 10,
      framework: "vite",
    };
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "full",
      diff: null,
      scans: [{ directory: "/repo", result: result({ project: preactProject }) }],
      totalElapsedMilliseconds: 1200,
    });
    expect(report.reactDetected).toBe(true);
  });

  it("omits reactDetected when nothing was scanned", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "staged",
      diff: null,
      scans: [],
      totalElapsedMilliseconds: 1200,
    });
    expect("reactDetected" in report).toBe(false);
  });

  it("emits a v3 baseline report carrying the new/fixed delta and head score", () => {
    const report = buildJsonReport({
      version: "1.2.3",
      directory: "/repo",
      mode: "diff",
      diff: null,
      scans: [{ directory: "/repo", result: result() }],
      totalElapsedMilliseconds: 1200,
      baseline: { baseRef: "abc1234def", fixedCount: 3, baseTotalCount: 5 },
    });
    expect(report.schemaVersion).toBe(3);
    expect(report.mode).toBe("baseline");
    expect(report.baseline?.baseRef).toBe("abc1234def");
    expect(report.baseline?.newCount).toBe(1); // one introduced finding
    expect(report.baseline?.fixedCount).toBe(3);
    expect(report.baseline?.baseTotalCount).toBe(5);
    // Score stays the head project-health number; counts reflect introduced only.
    expect(report.summary.score).toBe(88);
    expect(report.summary.totalDiagnosticCount).toBe(1);
    expect(report.summary.errorCount).toBe(1);
  });
});
