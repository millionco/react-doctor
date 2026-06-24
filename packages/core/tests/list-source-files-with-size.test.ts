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
});
