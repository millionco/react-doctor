import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { __clearParseSourceFileCacheForTests } from "./parse-source-file.js";
import {
  resetCrossFileExportCaches,
  resolveCrossFileValueExportWithFilePath,
} from "./resolve-cross-file-function-export.js";

const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-class-export-"));
afterAll(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
const writeProject = (files: Readonly<Record<string, string>>) => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "project-"));
  fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(directory, "entry.ts"), "export {};");
  for (const [name, source] of Object.entries(files))
    fs.writeFileSync(path.join(directory, name), source);
  __clearParseSourceFileCacheForTests();
  resetCrossFileExportCaches();
  return path.join(directory, "entry.ts");
};
describe("strict imported class value lookup", () => {
  it.each([
    ["direct named", "export class Resource {}", "Resource"],
    ["local renamed", "class Local {};export {Local as Resource};", "Resource"],
    ["direct default", "export default class Resource {}", "default"],
    ["local default", "class Resource {};export default Resource;", "default"],
  ])("retains %s ownership", (_description, producer, exportedName) => {
    const entry = writeProject({ "resource.ts": producer });
    const result = resolveCrossFileValueExportWithFilePath(entry, "./resource", exportedName, {
      requireCompleteReexports: true,
    });
    expect(result?.exportedNode.type).toBe("ClassDeclaration");
    expect(result?.contexts?.map((context) => context.role)).toEqual(["definition"]);
  });
  it("does not resolve ambiguous star class exports", () => {
    const entry = writeProject({
      "resource.ts": 'export * from "./first";export * from "./second";',
      "first.ts": "export class Resource {}",
      "second.ts": "export class Resource {}",
    });
    expect(
      resolveCrossFileValueExportWithFilePath(entry, "./resource", "Resource", {
        requireCompleteReexports: true,
      }),
    ).toBeNull();
  });
  it("does not materialize a type-only class value export", () => {
    const entry = writeProject({ "resource.ts": "class Resource {};export type {Resource};" });
    expect(
      resolveCrossFileValueExportWithFilePath(entry, "./resource", "Resource", {
        requireCompleteReexports: true,
      }),
    ).toBeNull();
  });
});
