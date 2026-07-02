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
});
