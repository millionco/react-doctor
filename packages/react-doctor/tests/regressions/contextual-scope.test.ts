import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createChangedLineMatcher,
  discoverProject,
  runOxlint,
  getChangedLineRanges,
} from "@react-doctor/core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { inspect } from "../../src/inspect.js";
import { resolveProjectChangedLineRanges } from "../../src/cli/utils/resolve-project-diff-include-paths.js";
import { initGitRepo, setupReactProject } from "./_helpers.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const SOURCE = [
  'import { useState } from "react";',
  "export const App = () => {",
  "  const [value] = useState(expensive());",
  "  const label = 'Before';",
  "  return <div>{value}</div>;",
  "};",
  "export const Other = () => {",
  "  const [value] = useState(otherExpensive());",
  "  return <div>{value}</div>;",
  "};",
  "",
].join("\n");

describe("contextual scope through Git and inspect", () => {
  it.each([false, true])(
    "reports an existing function finding after a deletion (staged=%s)",
    async (cached) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-contextual-git-"));
      temporaryDirectories.push(directory);
      const projectDirectory = setupReactProject(directory, "apps/web", {
        files: { "src/App.tsx": SOURCE },
      });
      initGitRepo(directory, { commit: true });
      const sourcePath = path.join(projectDirectory, "src/App.tsx");
      fs.writeFileSync(sourcePath, SOURCE.replace("  const label = 'Before';\n", ""));
      if (cached) execFileSync("git", ["add", "apps/web/src/App.tsx"], { cwd: directory });

      const ranges = await getChangedLineRanges({
        directory,
        baseRef: "HEAD",
        cached,
        files: ["apps/web/src/App.tsx"],
        includeDeletions: true,
      });
      expect(ranges).toEqual([{ file: "apps/web/src/App.tsx", ranges: [], deletionLines: [3] }]);
      const changedLineRanges = resolveProjectChangedLineRanges(
        directory,
        projectDirectory,
        ranges ?? [],
      );
      const options = {
        noScore: true,
        silent: true,
        deadCode: false,
        supplyChain: false,
        includePaths: ["src/App.tsx"],
        changedLineRanges,
      };
      const lineResult = await inspect(projectDirectory, options);
      const contextualResult = await inspect(projectDirectory, { ...options, contextual: true });
      expect(lineResult.diagnostics).toEqual([]);
      const findings = contextualResult.diagnostics.filter(
        (diagnostic) => diagnostic.rule === "rerender-lazy-state-init",
      );
      expect(findings.map((diagnostic) => diagnostic.line)).toEqual([3]);
      expect(findings[0].message).toContain("expensive()");
    },
  );
});

describe("explicit hook ownership through oxlint and inspect", () => {
  it.each([false, true])(
    "reports dependency findings for callback edits (named=%s)",
    async (named) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-contextual-hook-"));
      temporaryDirectories.push(directory);
      const source = [
        'import { useEffect } from "react";',
        'const heading = "é😀";',
        "export const App = ({ value }) => {",
        named ? "  const callback = () => {" : "  useEffect(() => {",
        "    console.log(value);",
        '    console.log("editing here");',
        named ? "  };" : "  }, []);",
        ...(named ? ["  useEffect(callback, []);"] : []),
        "  useEffect(() => {",
        "    console.log(value);",
        "  }, []);",
        "  return <div>{heading}</div>;",
        "};",
        "",
      ].join("\n");
      const projectDirectory = setupReactProject(directory, "web", {
        files: { "src/App.tsx": source },
      });
      const options = {
        noScore: true,
        silent: true,
        deadCode: false,
        supplyChain: false,
        includePaths: ["src/App.tsx"],
        changedLineRanges: [
          { file: "src/App.tsx", ranges: [[6, 6]] satisfies Array<[number, number]> },
        ],
      };
      const lineResult = await inspect(projectDirectory, options);
      expect(
        lineResult.diagnostics.filter((diagnostic) => diagnostic.rule === "exhaustive-deps"),
      ).toEqual([]);
      const contextualResult = await inspect(projectDirectory, { ...options, contextual: true });
      const findings = contextualResult.diagnostics.filter(
        (diagnostic) => diagnostic.rule === "exhaustive-deps",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].line).toBe(named ? 8 : 7);
      expect(findings[0].message).toContain("value");
    },
  );
});

describe("explicit ownership from the per-file cache", () => {
  it("replays owners from a full scan before applying contextual filtering", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-contextual-cache-"));
    temporaryDirectories.push(directory);
    const source = [
      'import { useEffect } from "react";',
      "export const App = ({ value }) => {",
      "  useEffect(() => {",
      "    console.log(value);",
      "  }, []);",
      "  return <div />;",
      "};",
    ].join("\n");
    const projectDirectory = setupReactProject(directory, "web", {
      files: { "src/App.tsx": source },
    });
    const options = {
      rootDirectory: projectDirectory,
      project: discoverProject(projectDirectory),
      includePaths: ["src/App.tsx"],
      adoptExistingLintConfig: false,
      perFileLintCacheEnabled: true,
    };
    const initial = await runOxlint(options);
    const cacheStats: Array<[number, number]> = [];
    const replayed = await runOxlint({
      ...options,
      onCacheStats: (hits, total) => {
        cacheStats.push([hits, total]);
      },
    });
    expect(cacheStats).toEqual([[1, 1]]);
    const matcher = createChangedLineMatcher({
      directory: projectDirectory,
      contextual: true,
      changedLineRanges: [{ file: "src/App.tsx", ranges: [[4, 4]] }],
    });
    const initialFindings = initial.filter((diagnostic) => diagnostic.rule === "exhaustive-deps");
    const replayedFindings = replayed.filter((diagnostic) => diagnostic.rule === "exhaustive-deps");
    expect(initialFindings).toHaveLength(1);
    expect(replayedFindings).toHaveLength(1);
    expect(replayedFindings[0].contextRanges).toEqual(initialFindings[0].contextRanges);
    expect(replayedFindings.filter(matcher)).toHaveLength(1);
  });
});
