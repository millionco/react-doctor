import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { collectSourceFileCountsByDirectory } from "../src/utils/collect-source-file-counts-by-directory.js";

describe("collectSourceFileCountsByDirectory", () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-counts-"));
  });

  afterEach(() => {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  it("assigns each source file to its nearest project directory", async () => {
    const appDirectory = path.join(rootDirectory, "packages/app");
    const nestedDirectory = path.join(appDirectory, "packages/nested");
    const otherDirectory = path.join(rootDirectory, "packages/other");
    const sourceFiles = [
      path.join(rootDirectory, "src/root.tsx"),
      path.join(appDirectory, "src/app.tsx"),
      path.join(nestedDirectory, "src/nested.tsx"),
      path.join(otherDirectory, "src/other.tsx"),
    ];
    for (const sourceFile of sourceFiles) {
      fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
      fs.writeFileSync(sourceFile, "export {};\n");
    }

    const sourceFileCounts = await collectSourceFileCountsByDirectory(rootDirectory, [
      rootDirectory,
      appDirectory,
      nestedDirectory,
      otherDirectory,
    ]);

    expect(sourceFileCounts).toEqual(
      new Map([
        [rootDirectory, 1],
        [appDirectory, 1],
        [nestedDirectory, 1],
        [otherDirectory, 1],
      ]),
    );
  });

  it("omits directories outside the enumerated root so callers can count them locally", async () => {
    const outsideDirectory = path.join(path.dirname(rootDirectory), "outside-project");
    const sourceFileCounts = await collectSourceFileCountsByDirectory(rootDirectory, [
      outsideDirectory,
    ]);
    expect(sourceFileCounts.has(outsideDirectory)).toBe(false);
  });

  it("stops before listing files when cancelled", async () => {
    await expect(
      collectSourceFileCountsByDirectory(rootDirectory, [rootDirectory], AbortSignal.abort()),
    ).rejects.toThrow();
  });
});
