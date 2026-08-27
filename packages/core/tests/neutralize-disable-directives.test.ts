import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { DISABLE_DIRECTIVE_BACKUP_DIRECTORY_SEGMENTS } from "../src/constants.js";
import { neutralizeDisableDirectives } from "../src/neutralize-disable-directives.js";

const getBackupRelativePath = (sourceRelativePath: string, scanRootRelativePath = ""): string =>
  path.join(
    scanRootRelativePath,
    ...DISABLE_DIRECTIVE_BACKUP_DIRECTORY_SEGMENTS,
    path.relative(scanRootRelativePath, sourceRelativePath),
  );

// A committed build-output bundle (e.g. `dist/`) is no longer scanned, so its
// inline disable directives must not be rewritten either — regardless of
// whether the git-grep path or the filesystem-walk fallback found the files,
// and regardless of whether the path arrived through an explicit `includePaths`
// list (diff / staged mode).
describe("neutralizeDisableDirectives — build-output exclusion", () => {
  let temporaryDirectory: string;

  const writeNestedFile = (relativePath: string, contents: string): void => {
    const filePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  };

  const readNestedFile = (relativePath: string): string =>
    fs.readFileSync(path.join(temporaryDirectory, relativePath), "utf-8");

  const SOURCE = "// eslint-disable-next-line\nexport const value = 1;\n";

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-neutralize-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("skips build-output paths on the filesystem walk and neutralizes real sources", async () => {
    writeNestedFile("src/app.tsx", SOURCE);
    writeNestedFile("dist/bundle.js", SOURCE);

    const restore = await neutralizeDisableDirectives(temporaryDirectory);

    expect(readNestedFile("src/app.tsx")).toContain("eslint_disable");
    expect(readNestedFile("dist/bundle.js")).toContain("eslint-disable");
    restore();
    expect(readNestedFile("src/app.tsx")).toContain("eslint-disable");
  });

  it("skips build-output paths passed explicitly via includePaths", async () => {
    writeNestedFile("src/app.tsx", SOURCE);
    writeNestedFile("dist/bundle.js", SOURCE);

    const restore = await neutralizeDisableDirectives(temporaryDirectory, [
      "src/app.tsx",
      "dist/bundle.js",
    ]);

    expect(readNestedFile("src/app.tsx")).toContain("eslint_disable");
    expect(readNestedFile("dist/bundle.js")).toContain("eslint-disable");
    restore();
  });

  it("skips build-output paths on the git-grep discovery path", async () => {
    writeNestedFile("src/app.tsx", SOURCE);
    writeNestedFile("dist/bundle.js", SOURCE);
    const runGit = (...args: string[]): void => {
      const result = spawnSync("git", args, { cwd: temporaryDirectory });
      expect(result.status).toBe(0);
    };
    runGit("init", "--quiet");
    runGit("add", "-A");
    runGit("-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "--quiet", "-m", "init");

    const restore = await neutralizeDisableDirectives(temporaryDirectory);

    expect(readNestedFile("src/app.tsx")).toContain("eslint_disable");
    expect(readNestedFile("dist/bundle.js")).toContain("eslint-disable");
    restore();
  });

  it("keeps a shared file neutralized until every overlapping scan releases it", async () => {
    writeNestedFile("packages/app/src/app.tsx", SOURCE);

    const restoreRepositoryScan = await neutralizeDisableDirectives(temporaryDirectory);
    const restorePackageScan = await neutralizeDisableDirectives(
      path.join(temporaryDirectory, "packages/app"),
    );

    restoreRepositoryScan();
    expect(readNestedFile("packages/app/src/app.tsx")).toContain("eslint_disable");

    restorePackageScan();
    expect(readNestedFile("packages/app/src/app.tsx")).toContain("eslint-disable");
  });

  it("shares an active lease with an overlapping explicit file scan", async () => {
    writeNestedFile("packages/app/src/app.tsx", SOURCE);

    const restoreRepositoryScan = await neutralizeDisableDirectives(temporaryDirectory);
    const restoreExplicitScan = await neutralizeDisableDirectives(
      path.join(temporaryDirectory, "packages/app"),
      ["src/app.tsx"],
    );

    restoreExplicitScan();
    expect(readNestedFile("packages/app/src/app.tsx")).toContain("eslint_disable");

    restoreRepositoryScan();
    expect(readNestedFile("packages/app/src/app.tsx")).toContain("eslint-disable");
  });

  it("does not let a nested scan overtake an overlapping discovery", async () => {
    writeNestedFile("packages/app/src/app.tsx", SOURCE);
    const resolvedTemporaryDirectory = fs.realpathSync(temporaryDirectory);
    const sourcePath = path.join(temporaryDirectory, "packages/app/src/app.tsx");
    let signalRootStarted!: () => void;
    const rootStarted = new Promise<void>((resolve) => {
      signalRootStarted = resolve;
    });
    let signalRootRead!: () => void;
    const rootRead = new Promise<void>((resolve) => {
      signalRootRead = resolve;
    });
    const delay = (milliseconds: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const findFiles = async (rootDirectory: string): Promise<string[]> => {
      if (rootDirectory === resolvedTemporaryDirectory) {
        signalRootStarted();
        await delay(50);
        const matched = fs.readFileSync(sourcePath, "utf-8").includes("eslint-disable");
        signalRootRead();
        await delay(50);
        return matched ? ["packages/app/src/app.tsx"] : [];
      }
      return fs.readFileSync(sourcePath, "utf-8").includes("eslint-disable") ? ["src/app.tsx"] : [];
    };

    const repositoryRestorePromise = neutralizeDisableDirectives(temporaryDirectory, undefined, {
      findFiles,
    });
    await rootStarted;
    let rootHasRead = false;
    let packageRestore: (() => void) | undefined;
    const packageRestorePromise = neutralizeDisableDirectives(
      path.join(temporaryDirectory, "packages/app"),
      undefined,
      { findFiles },
    ).then((restore) => {
      packageRestore = restore;
      if (rootHasRead) restore();
      return restore;
    });
    await rootRead;
    rootHasRead = true;
    packageRestore?.();

    const [repositoryRestore] = await Promise.all([
      repositoryRestorePromise,
      packageRestorePromise,
    ]);
    expect(readNestedFile("packages/app/src/app.tsx")).toContain("eslint_disable");
    repositoryRestore();
    expect(readNestedFile("packages/app/src/app.tsx")).toBe(SOURCE);
  }, 5_000);

  it("keeps the backup when its final restore fails", async () => {
    writeNestedFile("src/app.tsx", SOURCE);
    const restoreFirstScan = await neutralizeDisableDirectives(temporaryDirectory);
    fs.rmSync(path.join(temporaryDirectory, "src/app.tsx"));
    restoreFirstScan();

    const replacement = "// eslint-disable-next-line -- replacement\nexport const value = 2;\n";
    writeNestedFile("src/app.tsx", replacement);
    const restoreSecondScan = await neutralizeDisableDirectives(temporaryDirectory);
    expect(readNestedFile("src/app.tsx")).toBe(replacement);
    restoreSecondScan();
    expect(readNestedFile("src/app.tsx")).toBe(replacement);
    expect(readNestedFile(getBackupRelativePath("src/app.tsx"))).toBe(SOURCE);
  });
});

describe("neutralizeDisableDirectives — backup recovery after ungraceful exit", () => {
  let temporaryDirectory: string;

  const writeNestedFile = (relativePath: string, contents: string): void => {
    const filePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  };

  const readNestedFile = (relativePath: string): string =>
    fs.readFileSync(path.join(temporaryDirectory, relativePath), "utf-8");

  const fileExists = (relativePath: string): boolean => {
    try {
      fs.accessSync(path.join(temporaryDirectory, relativePath));
      return true;
    } catch {
      return false;
    }
  };

  const SOURCE = "// eslint-disable-next-line\nexport const value = 1;\n";

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-neutralize-backup-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("creates backup files when neutralizing", async () => {
    writeNestedFile("src/app.tsx", SOURCE);

    const restore = await neutralizeDisableDirectives(temporaryDirectory);

    expect(readNestedFile("src/app.tsx")).toContain("eslint_disable");
    expect(fileExists(getBackupRelativePath("src/app.tsx"))).toBe(true);
    expect(readNestedFile(getBackupRelativePath("src/app.tsx"))).toBe(SOURCE);

    restore();
  });

  it("deletes backup files after successful restoration", async () => {
    writeNestedFile("src/app.tsx", SOURCE);

    const restore = await neutralizeDisableDirectives(temporaryDirectory);
    expect(fileExists(getBackupRelativePath("src/app.tsx"))).toBe(true);

    restore();

    expect(readNestedFile("src/app.tsx")).toBe(SOURCE);
    expect(fileExists(getBackupRelativePath("src/app.tsx"))).toBe(false);
  });

  it("restores orphaned backups from previous ungraceful exit", async () => {
    const NEUTRALIZED = "// eslint_disable-next-line\nexport const value = 1;\n";
    writeNestedFile("src/app.tsx", NEUTRALIZED);
    writeNestedFile(getBackupRelativePath("src/app.tsx"), SOURCE);

    await neutralizeDisableDirectives(temporaryDirectory, undefined, {
      recoverOnly: true,
    });

    expect(readNestedFile("src/app.tsx")).toBe(SOURCE);
    expect(fileExists(getBackupRelativePath("src/app.tsx"))).toBe(false);
  });

  it("restores multiple orphaned backups", async () => {
    const SOURCE_2 = "// oxlint-disable\nexport const other = 2;\n";
    const NEUTRALIZED_1 = "// eslint_disable-next-line\nexport const value = 1;\n";
    const NEUTRALIZED_2 = "// oxlint_disable\nexport const other = 2;\n";

    writeNestedFile("src/app.tsx", NEUTRALIZED_1);
    writeNestedFile(getBackupRelativePath("src/app.tsx"), SOURCE);
    writeNestedFile("src/utils.ts", NEUTRALIZED_2);
    writeNestedFile(getBackupRelativePath("src/utils.ts"), SOURCE_2);

    await neutralizeDisableDirectives(temporaryDirectory, undefined, {
      recoverOnly: true,
    });

    expect(readNestedFile("src/app.tsx")).toBe(SOURCE);
    expect(readNestedFile("src/utils.ts")).toBe(SOURCE_2);
    expect(fileExists(getBackupRelativePath("src/app.tsx"))).toBe(false);
    expect(fileExists(getBackupRelativePath("src/utils.ts"))).toBe(false);
  });

  it("keeps the backup when the original file is missing", async () => {
    writeNestedFile(getBackupRelativePath("src/app.tsx"), SOURCE);

    await neutralizeDisableDirectives(temporaryDirectory, undefined, {
      recoverOnly: true,
    });

    expect(fileExists("src/app.tsx")).toBe(false);
    expect(fileExists(getBackupRelativePath("src/app.tsx"))).toBe(true);
  });

  it("does not overwrite a file changed after an ungraceful exit", async () => {
    const changedSource = "export const value = 2;\n";
    writeNestedFile("src/app.tsx", changedSource);
    writeNestedFile(getBackupRelativePath("src/app.tsx"), SOURCE);

    await neutralizeDisableDirectives(temporaryDirectory, undefined, {
      recoverOnly: true,
    });

    expect(readNestedFile("src/app.tsx")).toBe(changedSource);
    expect(readNestedFile(getBackupRelativePath("src/app.tsx"))).toBe(SOURCE);
  });

  it("does not overwrite a file changed during a scan", async () => {
    writeNestedFile("src/app.tsx", SOURCE);
    const restore = await neutralizeDisableDirectives(temporaryDirectory);
    const changedSource = "export const value = 3;\n";
    writeNestedFile("src/app.tsx", changedSource);

    restore();

    expect(readNestedFile("src/app.tsx")).toBe(changedSource);
    expect(readNestedFile(getBackupRelativePath("src/app.tsx"))).toBe(SOURCE);
  });

  it("deletes a stale backup after the source was already restored", async () => {
    writeNestedFile("src/app.tsx", SOURCE);
    writeNestedFile(getBackupRelativePath("src/app.tsx"), SOURCE);

    await neutralizeDisableDirectives(temporaryDirectory, undefined, {
      recoverOnly: true,
    });

    expect(readNestedFile("src/app.tsx")).toBe(SOURCE);
    expect(fileExists(getBackupRelativePath("src/app.tsx"))).toBe(false);
  });

  it("does not restore backups outside the scan scope", async () => {
    const SOURCE_NESTED = "// eslint-disable\nconst nested = 1;\n";
    const NEUTRALIZED_NESTED = "// eslint_disable\nconst nested = 1;\n";

    writeNestedFile("packages/app/src/app.tsx", NEUTRALIZED_NESTED);
    writeNestedFile(
      getBackupRelativePath("packages/app/src/app.tsx", "packages/app"),
      SOURCE_NESTED,
    );

    writeNestedFile("packages/other/src/other.tsx", NEUTRALIZED_NESTED);
    writeNestedFile(
      getBackupRelativePath("packages/other/src/other.tsx", "packages/other"),
      SOURCE_NESTED,
    );

    await neutralizeDisableDirectives(path.join(temporaryDirectory, "packages/app"), undefined, {
      recoverOnly: true,
    });

    expect(readNestedFile("packages/app/src/app.tsx")).toBe(SOURCE_NESTED);
    expect(fileExists(getBackupRelativePath("packages/app/src/app.tsx", "packages/app"))).toBe(
      false,
    );

    expect(readNestedFile("packages/other/src/other.tsx")).toBe(NEUTRALIZED_NESTED);
    expect(
      fileExists(getBackupRelativePath("packages/other/src/other.tsx", "packages/other")),
    ).toBe(true);
  });
});
