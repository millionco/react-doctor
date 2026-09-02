import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolvePositionalScanInput } from "../src/cli/utils/resolve-positional-scan-input.js";

describe("resolvePositionalScanInput", () => {
  let currentDirectory: string;

  beforeEach(() => {
    currentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-positional-input-"));
    fs.mkdirSync(path.join(currentDirectory, "src"));
    fs.writeFileSync(path.join(currentDirectory, "src", "a.tsx"), "export const A = () => null;\n");
  });

  afterEach(() => {
    fs.rmSync(currentDirectory, { recursive: true, force: true });
  });

  it("uses the current directory when no path is passed", () => {
    expect(resolvePositionalScanInput([], currentDirectory)).toEqual({
      directory: currentDirectory,
      filePaths: undefined,
    });
  });

  it("keeps one directory as the scan directory", () => {
    expect(resolvePositionalScanInput(["src"], currentDirectory)).toEqual({
      directory: "src",
      filePaths: undefined,
    });
  });

  it("treats one source file as an explicit file selection", () => {
    expect(resolvePositionalScanInput(["src/a.tsx"], currentDirectory)).toEqual({
      directory: currentDirectory,
      filePaths: ["src/a.tsx"],
    });
  });

  it("normalizes and deduplicates several file paths", () => {
    expect(
      resolvePositionalScanInput(
        ["./src/a.tsx", path.join(currentDirectory, "src", "a.tsx"), "src/missing.tsx"],
        currentDirectory,
      ),
    ).toEqual({
      directory: currentDirectory,
      filePaths: ["src/a.tsx", "src/missing.tsx"],
    });
  });

  it("keeps a missing non-source path compatible with directory scans", () => {
    expect(resolvePositionalScanInput(["missing-project"], currentDirectory)).toEqual({
      directory: "missing-project",
      filePaths: undefined,
    });
  });

  it("rejects a directory mixed with file paths", () => {
    expect(() => resolvePositionalScanInput(["src", "src/a.tsx"], currentDirectory)).toThrow(
      "Cannot combine the directory",
    );
  });

  it("rejects files outside the current directory", () => {
    expect(() =>
      resolvePositionalScanInput(
        [path.join(currentDirectory, "..", "outside.tsx")],
        currentDirectory,
      ),
    ).toThrow("outside the current directory");
  });
});
