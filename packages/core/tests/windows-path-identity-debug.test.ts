import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.runIf(process.platform === "win32")("Windows filesystem identities", () => {
  it("reports temporary and junction path identities", () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-path-debug-"));
    temporaryDirectories.push(rootDirectory);
    const sourcePath = path.join(rootDirectory, "src", "index.ts");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(path.join(rootDirectory, "package.json"), "{}");
    fs.writeFileSync(sourcePath, "export const value = true;");

    const aliasParentDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-path-debug-alias-"),
    );
    temporaryDirectories.push(aliasParentDirectory);
    const aliasDirectory = path.join(aliasParentDirectory, "project");
    fs.symlinkSync(rootDirectory, aliasDirectory, "junction");
    const aliasSourcePath = path.join(aliasDirectory, "src", "index.ts");

    expect({
      temporaryDirectory: os.tmpdir(),
      rootDirectory,
      regularRootDirectory: fs.realpathSync(rootDirectory),
      nativeRootDirectory: fs.realpathSync.native(rootDirectory),
      regularSourcePath: fs.realpathSync(sourcePath),
      nativeSourcePath: fs.realpathSync.native(sourcePath),
      aliasDirectory,
      regularAliasDirectory: fs.realpathSync(aliasDirectory),
      nativeAliasDirectory: fs.realpathSync.native(aliasDirectory),
      regularAliasSourcePath: fs.realpathSync(aliasSourcePath),
      nativeAliasSourcePath: fs.realpathSync.native(aliasSourcePath),
    }).toEqual({});
  });
});
