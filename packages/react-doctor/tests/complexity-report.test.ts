import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildComplexityReport } from "../src/cli/utils/complexity-report.js";
import { renderComplexityReport } from "../src/cli/utils/render-complexity.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const stripAnsi = (input: string): string => input.replace(ANSI_ESCAPE_PATTERN, "");

const createTempGitRepository = (): string => {
  const repositoryDirectory = mkdtempSync(path.join(tmpdir(), "react-doctor-complexity-test-"));
  execFileSync("git", ["init"], { cwd: repositoryDirectory, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repositoryDirectory,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: repositoryDirectory,
    stdio: "ignore",
  });
  return repositoryDirectory;
};

const writeRepositoryFile = (
  repositoryDirectory: string,
  relativePath: string,
  contents: string,
): void => {
  const absolutePath = path.join(repositoryDirectory, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
};

const commitRepositoryState = (repositoryDirectory: string, message: string): string => {
  execFileSync("git", ["add", "."], { cwd: repositoryDirectory, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", message, "--quiet"], {
    cwd: repositoryDirectory,
    stdio: "ignore",
  });
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryDirectory,
    encoding: "utf8",
  }).trim();
};

describe("buildComplexityReport", () => {
  it("analyzes a project directory and renders ranked functions", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  if (value > 0) {
    return 1;
  }
  return 0;
}

export function beta(flag: boolean) {
  return flag;
}
`,
      );
      commitRepositoryState(repositoryDirectory, "base");

      const report = await buildComplexityReport({
        directory: repositoryDirectory,
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(report.mode).toBe("full");
      expect(report.summary.filesAnalyzed).toBe(1);
      expect(report.summary.totalFunctions).toBe(3);
      expect(report.summary.mostComplexFunction?.name).toBe("alpha");
      expect(report.files[0]?.relativePath).toBe("src/example.ts");
      expect(
        report.functions.every(
          (functionEntry) =>
            !functionEntry.relativePath.includes("\\") && !functionEntry.key.includes("\\"),
        ),
      ).toBe(true);
      expect(report.functions[0]?.name).toBe("alpha");
      expect(renderComplexityReport(report)).toContain("files analyzed");
      expect(renderComplexityReport(report)).toContain("cyclomatic");
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });

  it("computes diff output with added, removed, regressed, and improved functions", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  if (value > 0) {
    return 1;
  }
  return 0;
}

export function beta(flag: boolean) {
  if (flag) {
    return 1;
  }
  return 0;
}

export function legacy(flag: boolean) {
  if (flag) {
    return 1;
  }
  return 0;
}
`,
      );
      const baseCommit = commitRepositoryState(repositoryDirectory, "base");

      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  if (value > 0) {
    return 1;
  }
  if (value > 1) {
    return 2;
  }
  return 0;
}

export function beta(flag: boolean) {
  return flag;
}

export function gamma(flag: boolean) {
  return flag ? 1 : 0;
}
`,
      );

      const report = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: baseCommit,
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(report.mode).toBe("diff");
      expect(report.diff?.computed).toBe(true);
      expect(report.diff?.regressedCount).toBe(1);
      expect(report.diff?.improvedCount).toBe(1);
      expect(report.diff?.addedCount).toBe(1);
      expect(report.diff?.removedCount).toBe(1);
      expect(renderComplexityReport(report)).toContain("net cyclomatic");
      expect(renderComplexityReport(report)).toContain("added");
      const removedEntry = report.functions.find(
        (functionEntry) => functionEntry.status === "removed",
      );
      expect(removedEntry?.filePath).toBe(
        path.resolve(repositoryDirectory, removedEntry?.relativePath ?? ""),
      );
      expect(report.functions.length).toBeGreaterThan(0);
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps same-named methods in different classes from colliding in diff joins", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
class First {
  render() {
    return 1;
  }
}

class Second {
  render() {
    if (flag) {
      return 2;
    }
    return 0;
  }
}
`,
      );
      const baseCommit = commitRepositoryState(repositoryDirectory, "base");

      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
class Second {
  render() {
    return 2;
  }
}

class First {
  render() {
    if (flag) {
      return 1;
    }
    return 0;
  }
}
`,
      );

      const report = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: baseCommit,
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(report.diff?.computed).toBe(true);
      const renderEntries = report.diff?.functions.filter(
        (functionEntry) => functionEntry.name === "render",
      );
      expect(renderEntries).toHaveLength(2);
      expect(new Set(renderEntries?.map((functionEntry) => functionEntry.key)).size).toBe(2);
      expect(
        renderEntries?.some((functionEntry) => functionEntry.key.includes("class:First")),
      ).toBe(true);
      expect(
        renderEntries?.some((functionEntry) => functionEntry.key.includes("class:Second")),
      ).toBe(true);
      expect(
        renderEntries?.some(
          (functionEntry) =>
            functionEntry.relativePath === "src/example.ts" &&
            functionEntry.status === "changed" &&
            functionEntry.cyclomaticDelta > 0,
        ),
      ).toBe(true);
      expect(
        renderEntries?.some(
          (functionEntry) =>
            functionEntry.relativePath === "src/example.ts" &&
            functionEntry.status === "changed" &&
            functionEntry.cyclomaticDelta < 0,
        ),
      ).toBe(true);
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });

  it("treats a valid empty base tree as an added diff", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(repositoryDirectory, "README.md", "base\n");
      const baseCommit = commitRepositoryState(repositoryDirectory, "base");

      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  return value + 1;
}

export function beta(flag: boolean) {
  if (flag) {
    return 1;
  }
  return 0;
}
`,
      );

      const report = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: baseCommit,
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(report.diff?.computed).toBe(true);
      expect(
        report.diff?.functions.every((functionEntry) => functionEntry.status === "added"),
      ).toBe(true);
      expect(report.diff?.addedCount).toBe(report.diff?.functions.length);
      expect(report.diff?.removedCount).toBe(0);
      expect(report.diff?.regressedCount).toBe(0);
      expect(report.diff?.improvedCount).toBe(0);
      expect(
        report.diff?.functions.every(
          (functionEntry) =>
            functionEntry.rawLinesChanged === null && functionEntry.bloatRatio === null,
        ),
      ).toBe(true);
      expect(Number.isFinite(report.diff?.changeComplexityScore ?? Number.NaN)).toBe(true);
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });

  it("sorts diff rows by the selected metric", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  return value;
}

export function beta(items: string[]) {
  return items.length;
}
`,
      );
      const baseCommit = commitRepositoryState(repositoryDirectory, "base");

      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  if (value > 0) {
    switch (value) {
      case 1:
        return 1;
      case 2:
        return 2;
      default:
        return 3;
    }
  }
  return 0;
}

export function beta(items: string[]) {
  outer: for (const item of items) {
    if (item === "skip") {
      continue outer;
    }
  }
  return items.length;
}
`,
      );

      const cyclomaticReport = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: baseCommit,
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });
      const cyclomaticRenderedRows = stripAnsi(renderComplexityReport(cyclomaticReport))
        .split("\n")
        .filter((line) => line.startsWith("src/example.ts:"));
      expect(cyclomaticReport.diff?.functions[0]?.name).toBe("alpha");
      expect(cyclomaticRenderedRows[0]).toContain("alpha");

      const cognitiveReport = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: baseCommit,
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cognitive",
      });
      const cognitiveRenderedRows = stripAnsi(renderComplexityReport(cognitiveReport))
        .split("\n")
        .filter((line) => line.startsWith("src/example.ts:"));
      expect(cognitiveReport.diff?.functions[0]?.name).toBe("beta");
      expect(cognitiveRenderedRows[0]).toContain("beta");
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });

  it("counts cognitive-only changes in the diff summary", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(items: string[]) {
  for (const item of items) {
    if (item === "stop") {
      break;
    }
  }
  return items.length;
}
`,
      );
      const baseCommit = commitRepositoryState(repositoryDirectory, "base");

      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(items: string[]) {
  outer: for (const item of items) {
    if (item === "stop") {
      break outer;
    }
  }
  return items.length;
}
`,
      );

      const report = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: baseCommit,
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(report.diff?.computed).toBe(true);
      expect(report.diff?.regressedCount).toBe(1);
      expect(report.diff?.improvedCount).toBe(0);
      expect(report.diff?.netCyclomaticChange).toBe(0);
      expect(report.diff?.netCognitiveChange).toBeGreaterThan(0);
      const cognitiveOnlyFunction = report.diff?.functions.find(
        (functionEntry) => functionEntry.cyclomaticDelta === 0 && functionEntry.cognitiveDelta > 0,
      );
      expect(cognitiveOnlyFunction?.cognitiveDelta).toBeGreaterThan(0);
      expect(renderComplexityReport(report)).toContain("regressed 1");
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps diff JSON and rendered rows aligned under --min", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  return value;
}

export function beta(items: string[]) {
  return items.length;
}
`,
      );
      const baseCommit = commitRepositoryState(repositoryDirectory, "base");

      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  if (value > 0) {
    switch (value) {
      case 1:
        return 1;
      case 2:
        return 2;
      default:
        return 3;
    }
  }
  return 0;
}

export function beta(items: string[]) {
  outer: for (const item of items) {
    if (item === "skip") {
      continue outer;
    }
  }
  return items.length;
}
`,
      );

      const report = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: baseCommit,
        top: 20,
        minCyclomatic: 4,
        sortMetric: "cyclomatic",
      });
      const renderedRows = stripAnsi(renderComplexityReport(report))
        .split("\n")
        .filter((line) => line.startsWith("src/example.ts:"));

      expect(report.functions).toHaveLength(1);
      expect(renderedRows).toHaveLength(1);
      expect(report.functions[0]?.name).toBe("alpha");
      expect(renderedRows[0]).toContain("alpha");
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });

  it("resolves relative diff refs before materializing baseline files", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  if (value > 0) {
    return 1;
  }
  return 0;
}
`,
      );
      commitRepositoryState(repositoryDirectory, "base");

      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  if (value > 0) {
    return 1;
  }
  if (value > 1) {
    return 2;
  }
  return 0;
}
`,
      );
      const headCommit = commitRepositoryState(repositoryDirectory, "head");
      const resolvedBaseRef = execFileSync("git", ["rev-parse", "HEAD~1"], {
        cwd: repositoryDirectory,
        encoding: "utf8",
      }).trim();

      const relativeRefReport = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: "HEAD~1",
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(relativeRefReport.mode).toBe("diff");
      expect(relativeRefReport.diff?.computed).toBe(true);
      expect(relativeRefReport.diff?.baseRef).toBe(resolvedBaseRef);
      expect(relativeRefReport.diff?.netCyclomaticChange).toBe(1);
      expect(relativeRefReport.diff?.functions[0]?.status).toBe("changed");

      const caretRefReport = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: "HEAD^",
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(caretRefReport.diff?.computed).toBe(true);
      expect(caretRefReport.diff?.baseRef).toBe(resolvedBaseRef);
      expect(caretRefReport.diff?.netCyclomaticChange).toBe(
        relativeRefReport.diff?.netCyclomaticChange,
      );
      expect(headCommit).toHaveLength(40);
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });

  it("includes formatting-only changes and diff entropy in the summary", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function formatOnly(value: number) { return value + 1; }

export function structural(value: number) {
  return value;
}

export function secondaryStructural(value: number) {
  return value;
}
`,
      );
      const baseCommit = commitRepositoryState(repositoryDirectory, "base");

      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function formatOnly(value: number) {
  return value + 1;
}

export function structural(value: number) {
  if (value > 0) {
    return value;
  }
  return 0;
}

export function secondaryStructural(value: number) {
  if (value > 1) {
    return value;
  }
  return 0;
}
`,
      );

      const report = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: baseCommit,
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(report.mode).toBe("diff");
      expect(report.diff?.computed).toBe(true);
      expect(report.diff?.functions).toHaveLength(4);

      const formatOnly = report.diff?.functions.find(
        (functionEntry) => functionEntry.name === "formatOnly",
      );
      const structural = report.diff?.functions.find(
        (functionEntry) => functionEntry.name === "structural",
      );
      const secondaryStructural = report.diff?.functions.find(
        (functionEntry) => functionEntry.name === "secondaryStructural",
      );

      expect(formatOnly).toMatchObject({
        essentialChange: 0,
        rawLinesChanged: expect.any(Number),
        bloatRatio: expect.any(Number),
      });
      expect(formatOnly?.rawLinesChanged).toBeGreaterThan(0);
      expect(formatOnly?.bloatRatio).toBeGreaterThan(0);
      expect(structural?.essentialChange).toBeGreaterThan(0);
      expect(secondaryStructural?.essentialChange).toBeGreaterThan(0);
      expect(report.diff?.totalEssentialChange).toBeGreaterThan(0);
      expect(report.diff?.changeEntropy).toBeGreaterThan(0);
      expect(report.diff?.normalizedChangeEntropy).toBeGreaterThanOrEqual(0);
      expect(report.diff?.changeComplexityScore).toBeGreaterThan(
        report.diff?.totalEssentialChange ?? 0,
      );
      expect(stripAnsi(renderComplexityReport(report))).toContain(
        "change complexity total essential",
      );
      expect(stripAnsi(renderComplexityReport(report))).toContain("raw lines");
    } finally {
      rmSync(repositoryDirectory, { recursive: true });
    }
  });

  it("falls back to head-only complexity when the diff ref cannot be materialized", async () => {
    const repositoryDirectory = createTempGitRepository();
    try {
      writeRepositoryFile(
        repositoryDirectory,
        "src/example.ts",
        `
export function alpha(value: number) {
  if (value > 0) {
    return 1;
  }
  return 0;
}
`,
      );
      commitRepositoryState(repositoryDirectory, "base");

      const report = await buildComplexityReport({
        directory: repositoryDirectory,
        diffRef: "does-not-exist",
        top: 20,
        minCyclomatic: 1,
        sortMetric: "cyclomatic",
      });

      expect(report.mode).toBe("diff");
      expect(report.diff?.computed).toBe(false);
      expect(renderComplexityReport(report)).toContain(
        "Could not compute diff against does-not-exist",
      );
      expect(renderComplexityReport(report)).toContain("cyclomatic");
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });
});
