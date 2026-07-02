import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  __clearResolveImportWithOxcCacheForTests,
  resolveImportWithOxc,
} from "./resolve-import-with-oxc.js";

let temporaryDirectory: string;

beforeEach(() => {
  // realpathSync: oxc-resolver returns real paths, and os.tmpdir() is a
  // symlink on macOS (/var -> /private/var).
  temporaryDirectory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "oxc-resolve-")));
  __clearResolveImportWithOxcCacheForTests();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const writeProjectManifest = (): void => {
  writeFile("package.json", JSON.stringify({ name: "fixture", type: "module" }));
};

describe("resolveImportWithOxc", () => {
  it("resolves a relative import to a .ts file", () => {
    writeProjectManifest();
    const target = writeFile("src/util.ts", "export const util = 1;");
    const fromFile = writeFile("src/app.ts", "import { util } from './util';");
    expect(resolveImportWithOxc(fromFile, "./util")).toBe(target);
  });

  it("resolves a relative import to a .tsx file", () => {
    writeProjectManifest();
    const target = writeFile("src/search.tsx", "export const Search = () => null;");
    const fromFile = writeFile("src/app.tsx", "import { Search } from './search';");
    expect(resolveImportWithOxc(fromFile, "./search")).toBe(target);
  });

  it("resolves a directory import to its index file", () => {
    writeProjectManifest();
    const target = writeFile("src/lib/index.ts", "export const lib = 1;");
    const fromFile = writeFile("src/app.ts", "import { lib } from './lib';");
    expect(resolveImportWithOxc(fromFile, "./lib")).toBe(target);
  });

  it("resolves a ./x.js specifier to x.ts via extensionAlias", () => {
    writeProjectManifest();
    const target = writeFile("src/math.ts", "export const add = () => 1;");
    const fromFile = writeFile("src/app.ts", "import { add } from './math.js';");
    expect(resolveImportWithOxc(fromFile, "./math.js")).toBe(target);
  });

  it("resolves a tsconfig paths alias", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    const target = writeFile("src/lib/foo.ts", "export const foo = 1;");
    const fromFile = writeFile("src/app/page.tsx", "import { foo } from '@/lib/foo';");
    expect(resolveImportWithOxc(fromFile, "@/lib/foo")).toBe(target);
  });

  it("returns null for a bare specifier resolving into node_modules", () => {
    writeProjectManifest();
    writeFile(
      "node_modules/some-package/package.json",
      JSON.stringify({ name: "some-package", main: "index.js" }),
    );
    writeFile("node_modules/some-package/index.js", "module.exports = {};");
    const fromFile = writeFile("src/app.ts", "import pkg from 'some-package';");
    expect(resolveImportWithOxc(fromFile, "some-package")).toBeNull();
  });

  it("returns null for an unresolvable specifier", () => {
    writeProjectManifest();
    const fromFile = writeFile("src/app.ts", "import { gone } from './does-not-exist';");
    expect(resolveImportWithOxc(fromFile, "./does-not-exist")).toBeNull();
  });

  it("returns null when fromFilename is not absolute", () => {
    writeProjectManifest();
    writeFile("src/util.ts", "export const util = 1;");
    expect(resolveImportWithOxc("src/app.ts", "./util")).toBeNull();
  });
});
