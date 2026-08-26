import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { neutralizeDisableDirectives } from "../../src/neutralize-disable-directives.js";

describe("issue #1687 — backup recovery after SIGKILL/power loss", () => {
  let temporaryDirectory: string;

  const writeFile = (relativePath: string, contents: string): void => {
    const filePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  };

  const readFile = (relativePath: string): string =>
    fs.readFileSync(path.join(temporaryDirectory, relativePath), "utf-8");

  const fileExists = (relativePath: string): boolean => {
    try {
      fs.accessSync(path.join(temporaryDirectory, relativePath));
      return true;
    } catch {
      return false;
    }
  };

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-issue-1687-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("restores user files from orphaned backups after ungraceful exit", async () => {
    const ORIGINAL = "// eslint-disable-next-line\nexport const value = 1;\n";
    const CORRUPTED = "// eslint_disable-next-line\nexport const value = 1;\n";

    writeFile("src/app.tsx", CORRUPTED);
    writeFile("src/app.tsx.react-doctor-backup", ORIGINAL);

    await neutralizeDisableDirectives(temporaryDirectory);

    expect(readFile("src/app.tsx")).toBe(ORIGINAL);
    expect(fileExists("src/app.tsx.react-doctor-backup")).toBe(false);
  });

  it("prevents re-corruption after restoration in the same run", async () => {
    const ORIGINAL = "// eslint-disable\nexport const other = 2;\n";
    const CORRUPTED = "// eslint_disable\nexport const other = 2;\n";

    writeFile("src/utils.ts", CORRUPTED);
    writeFile("src/utils.ts.react-doctor-backup", ORIGINAL);

    const restore = await neutralizeDisableDirectives(temporaryDirectory);

    expect(readFile("src/utils.ts")).toBe(ORIGINAL);

    restore();

    expect(readFile("src/utils.ts")).toBe(ORIGINAL);
  });

  it("creates backup files alongside mutations for future recovery", async () => {
    const ORIGINAL = "// oxlint-disable\nconst x = 1;\n";

    writeFile("src/config.ts", ORIGINAL);

    await neutralizeDisableDirectives(temporaryDirectory);

    expect(fileExists("src/config.ts.react-doctor-backup")).toBe(true);
    expect(readFile("src/config.ts.react-doctor-backup")).toBe(ORIGINAL);
  });
});
