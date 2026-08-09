import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { collectSourceFilesByDirectory } from "../src/utils/collect-source-files-by-directory.js";

describe("collectSourceFilesByDirectory", () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-files-"));
  });

  afterEach(() => {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  it("assigns sized project-relative entries to the nearest project directory", async () => {
    const appDirectory = path.join(rootDirectory, "packages/app");
    const nestedDirectory = path.join(appDirectory, "packages/nested");
    const appSourcePath = path.join(appDirectory, "src/app.tsx");
    const nestedSourcePath = path.join(nestedDirectory, "src/nested.tsx");
    for (const sourcePath of [appSourcePath, nestedSourcePath]) {
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, "export {}\n");
    }

    const sourceFilesByDirectory = await collectSourceFilesByDirectory(rootDirectory, [
      appDirectory,
      nestedDirectory,
    ]);

    expect(sourceFilesByDirectory.get(appDirectory)).toEqual([
      { path: "src/app.tsx", sizeBytes: fs.statSync(appSourcePath).size },
    ]);
    expect(sourceFilesByDirectory.get(nestedDirectory)).toEqual([
      { path: "src/nested.tsx", sizeBytes: fs.statSync(nestedSourcePath).size },
    ]);
  });
});
