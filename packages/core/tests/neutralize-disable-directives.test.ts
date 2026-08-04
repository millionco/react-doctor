import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { neutralizeDisableDirectives } from "../src/neutralize-disable-directives.js";

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

  it("discards a lease when its final restore fails", async () => {
    writeNestedFile("src/app.tsx", SOURCE);
    const restoreFirstScan = await neutralizeDisableDirectives(temporaryDirectory);
    fs.rmSync(path.join(temporaryDirectory, "src/app.tsx"));
    restoreFirstScan();

    const replacement = "// eslint-disable-next-line -- replacement\nexport const value = 2;\n";
    writeNestedFile("src/app.tsx", replacement);
    const restoreSecondScan = await neutralizeDisableDirectives(temporaryDirectory);
    expect(readNestedFile("src/app.tsx")).toContain("eslint_disable");
    restoreSecondScan();
    expect(readNestedFile("src/app.tsx")).toBe(replacement);
  });
});
