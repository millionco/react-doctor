import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { MINIFIED_MIN_SIZE_BYTES } from "../src/project-info/constants.js";
import { listSourceFiles, listSourceFilesWithSize } from "../src/utils/list-source-files.js";

describe("listSourceFilesWithSize", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "list-source-files-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeFile = (name: string, contents: string): string => {
    const filePath = path.join(temporaryDirectory, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
  };

  it("returns entries whose sizeBytes match the file's stat size", () => {
    const absolutePath = writeFile("App.tsx", "export const App = () => null;\n");

    const entries = listSourceFilesWithSize(temporaryDirectory);
    const appEntry = entries.find((entry) => entry.path === "App.tsx");

    expect(appEntry).toBeDefined();
    expect(appEntry!.path).toBe("App.tsx");
    expect(appEntry!.sizeBytes).toBe(fs.statSync(absolutePath).size);
  });

  it("excludes a large minified bundle (parity with listSourceFiles)", () => {
    writeFile("ok.ts", "export const value = 1;\n");
    const giantLine = `var bundle=${"a".repeat(MINIFIED_MIN_SIZE_BYTES + 5_000)};`;
    writeFile("vendor.js", giantLine);

    const sizedPaths = listSourceFilesWithSize(temporaryDirectory).map((entry) => entry.path);

    expect(sizedPaths).toContain("ok.ts");
    expect(sizedPaths).not.toContain("vendor.js");
    expect(listSourceFiles(temporaryDirectory)).not.toContain("vendor.js");
  });

  it("listSourceFiles equals listSourceFilesWithSize paths", () => {
    writeFile("index.ts", "export const index = 0;\n");
    writeFile("button.tsx", "export const Button = () => null;\n");
    writeFile("helper.js", "module.exports = () => {};\n");
    writeFile("widget.jsx", "export const Widget = () => null;\n");
    writeFile("notes.md", "# ignored\n");

    expect(listSourceFiles(temporaryDirectory)).toEqual(
      listSourceFilesWithSize(temporaryDirectory).map((entry) => entry.path),
    );
  });

  const writeNestedFile = (relativePath: string, contents: string): void => {
    const filePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  };

  // Issue: ant-design scans covered `.dumi/**` only when git discovery ran —
  // the filesystem walk skipped EVERY dot-directory, so the two paths
  // enumerated different sets for the same tree.
  it("filesystem walk descends into allowlisted dot-directories", () => {
    writeNestedFile(".dumi/hooks/use-local-storage.ts", "export const useLs = () => null;\n");
    writeNestedFile(".storybook/preview.tsx", "export const decorators = [];\n");
    writeNestedFile("src/app.tsx", "export const App = () => null;\n");
    writeNestedFile(".next/server/page.js", "module.exports = {};\n");
    writeNestedFile(".git/hooks/sample.js", "module.exports = {};\n");

    const filePaths = listSourceFiles(temporaryDirectory);

    expect(filePaths).toContain(".dumi/hooks/use-local-storage.ts");
    expect(filePaths).toContain(".storybook/preview.tsx");
    expect(filePaths).toContain("src/app.tsx");
    expect(filePaths).not.toContain(".next/server/page.js");
    expect(filePaths).not.toContain(".git/hooks/sample.js");
  });

  // Issue: a repo's `.codex/skills/**/scripts/*.mjs` agent-tooling scripts
  // were scanned as app code, producing 83 `no-console` false positives —
  // hidden directories outside the allowlist must be excluded by default.
  it("filesystem walk skips non-allowlisted hidden directories", () => {
    writeNestedFile(".codex/skills/translate/scripts/check.mjs", "console.log(1);\n");
    writeNestedFile(".github/scripts/release.mjs", "console.log(1);\n");
    writeNestedFile("src/app.tsx", "export const App = () => null;\n");

    const filePaths = listSourceFiles(temporaryDirectory);

    expect(filePaths).toContain("src/app.tsx");
    expect(filePaths).not.toContain(".codex/skills/translate/scripts/check.mjs");
    expect(filePaths).not.toContain(".github/scripts/release.mjs");
  });

  it("filesystem walk returns a sorted, repeatable listing", () => {
    writeNestedFile("zebra/last.tsx", "export const Last = () => null;\n");
    writeNestedFile("alpha/first.tsx", "export const First = () => null;\n");
    writeNestedFile("middle.ts", "export const middle = 1;\n");

    const firstListing = listSourceFiles(temporaryDirectory);

    expect(firstListing).toEqual([...firstListing].sort());
    expect(firstListing).toEqual(listSourceFiles(temporaryDirectory));
  });

  const runGit = (...args: string[]): void => {
    const result = spawnSync("git", args, { cwd: temporaryDirectory });
    expect(result.status).toBe(0);
  };

  // Issue: nteract/semiotic commits `ai/dist/mcp-server.js`, so `git
  // ls-files` listed it (gitignore only hides UNTRACKED files) and 44
  // bundled-artifact diagnostics reached the report.
  it("git discovery excludes committed build output and matches the filesystem walk", () => {
    writeNestedFile("ai/dist/mcp-server.js", "module.exports = () => {};\n");
    writeNestedFile("dist/index.js", "module.exports = 1;\n");
    writeNestedFile("src/app.tsx", "export const App = () => null;\n");
    writeNestedFile(".dumi/pages/banner.tsx", "export const Banner = () => null;\n");
    writeNestedFile(".codex/skills/translate/scripts/check.mjs", "console.log(1);\n");
    runGit("init", "--quiet");
    runGit("add", "-A");
    runGit(
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=test",
      "commit",
      "--quiet",
      "-m",
      "init",
    );

    const gitListing = listSourceFiles(temporaryDirectory);

    expect(gitListing).not.toContain("ai/dist/mcp-server.js");
    expect(gitListing).not.toContain("dist/index.js");
    expect(gitListing).not.toContain(".codex/skills/translate/scripts/check.mjs");
    expect(gitListing).toContain("src/app.tsx");
    expect(gitListing).toContain(".dumi/pages/banner.tsx");

    // Same tree without `.git` falls back to the filesystem walk; both
    // discovery paths must enumerate the identical (sorted) set.
    fs.rmSync(path.join(temporaryDirectory, ".git"), { recursive: true, force: true });
    expect(listSourceFiles(temporaryDirectory)).toEqual(gitListing);
  });

  const commitAll = (): void => {
    runGit("add", "-A");
    runGit(
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=test",
      "commit",
      "--quiet",
      "-m",
      "init",
    );
  };

  const writeEmitQuartet = (): void => {
    writeNestedFile("src/store.js", "export const store = 1;\n//# sourceMappingURL=store.js.map\n");
    writeNestedFile(
      "src/store.js.map",
      JSON.stringify({ file: "store.js", sources: ["store.ts"] }),
    );
    writeNestedFile(
      "src/store.d.ts",
      "export declare const store: number;\n//# sourceMappingURL=store.d.ts.map\n",
    );
    writeNestedFile(
      "src/store.d.ts.map",
      JSON.stringify({ file: "store.d.ts", sources: ["store.ts"] }),
    );
  };

  it("git discovery excludes an untracked TypeScript emit quartet duplicating tracked source", () => {
    writeNestedFile("src/store.ts", "export const store = 1;\n");
    writeNestedFile("src/app.tsx", "export const App = () => null;\n");
    runGit("init", "--quiet");
    commitAll();
    writeEmitQuartet();

    const filePaths = listSourceFiles(temporaryDirectory);

    expect(filePaths).toContain("src/store.ts");
    expect(filePaths).toContain("src/app.tsx");
    expect(filePaths).not.toContain("src/store.js");
  });

  it("git discovery keeps a tracked .js file and an incomplete emit set", () => {
    writeNestedFile("src/store.ts", "export const store = 1;\n");
    writeEmitQuartet();
    runGit("init", "--quiet");
    commitAll();
    writeNestedFile("src/other.ts", "export const other = 1;\n");
    writeNestedFile("src/other.js", "export const other = 1;\n//# sourceMappingURL=other.js.map\n");

    const filePaths = listSourceFiles(temporaryDirectory);

    expect(filePaths).toContain("src/store.js");
    expect(filePaths).toContain("src/other.js");
  });
});
