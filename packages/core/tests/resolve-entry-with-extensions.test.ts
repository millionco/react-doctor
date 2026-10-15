import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveEntryWithExtensions } from "../src/project-analysis/utils/resolve-entry-with-extensions.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createTemporaryDirectory = (): string => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-entry-"));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
};

describe("resolveEntryWithExtensions", () => {
  it("continues to directory index resolution when the entry path is a directory", () => {
    const rootDirectory = createTemporaryDirectory();
    const distDirectory = path.join(rootDirectory, "dist");
    fs.mkdirSync(distDirectory, { recursive: true });
    const distIndexPath = path.join(distDirectory, "index.js");
    fs.writeFileSync(distIndexPath, "export const value = 1;\n");

    expect(resolveEntryWithExtensions(distDirectory)).toBe(distIndexPath);
  });
});
