import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../constants/thresholds.js";
import { __clearParseSourceFileCacheForTests } from "./parse-source-file.js";
import { resolveCrossFileExport } from "./resolve-cross-file-export.js";

let temporaryDirectory: string;

beforeEach(() => {
  // realpathSync: oxc-resolver returns real paths, and os.tmpdir() is a
  // symlink on macOS (/var -> /private/var).
  temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cross-file-export-")),
  );
  __clearParseSourceFileCacheForTests();
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

const writeEntryFile = (): string => writeFile("src/app.tsx", "export const App = () => null;");

describe("resolveCrossFileExport", () => {
  it("resolves an exported function declaration", () => {
    writeProjectManifest();
    const target = writeFile("src/helper.ts", "export function helper() { return 1; }");
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./helper", "helper");
    expect(resolved).not.toBeNull();
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.kind).toBe("function");
    expect(resolved?.node.type).toBe("FunctionDeclaration");
  });

  it("resolves an exported arrow const as a function", () => {
    writeProjectManifest();
    const target = writeFile("src/helper.ts", "export const helper = () => 1;");
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./helper", "helper");
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.kind).toBe("function");
    expect(resolved?.node.type).toBe("ArrowFunctionExpression");
  });

  it("resolves an exported const initializer expression", () => {
    writeProjectManifest();
    const target = writeFile("src/config.ts", "export const config = { retries: 3 };");
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./config", "config");
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.kind).toBe("initializer");
    expect(resolved?.node.type).toBe("ObjectExpression");
  });

  it("resolves a const declared then exported via a specifier list", () => {
    writeProjectManifest();
    const target = writeFile("src/config.ts", "const config = { retries: 3 };\nexport { config };");
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./config", "config");
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.kind).toBe("initializer");
    expect(resolved?.node.type).toBe("ObjectExpression");
  });

  it("resolves a renamed in-file export (`export { config as settings }`)", () => {
    writeProjectManifest();
    const target = writeFile(
      "src/config.ts",
      "const config = [1, 2];\nexport { config as settings };",
    );
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./config", "settings");
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.kind).toBe("initializer");
    expect(resolved?.node.type).toBe("ArrayExpression");
  });

  it("resolves a renamed re-export of a const initializer", () => {
    writeProjectManifest();
    const target = writeFile("src/config.ts", "export const config = { retries: 3 };");
    writeFile("src/barrel.ts", "export { config as publicConfig } from './config';");
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./barrel", "publicConfig");
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.kind).toBe("initializer");
    expect(resolved?.node.type).toBe("ObjectExpression");
  });

  it("follows a two-hop barrel re-export chain to the owning file", () => {
    writeProjectManifest();
    const target = writeFile("src/features/helper.ts", "export function helper() { return 1; }");
    writeFile("src/features/index.ts", "export { helper } from './helper';");
    writeFile("src/index.ts", "export * from './features';");
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./index", "helper");
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.kind).toBe("function");
  });

  it("returns null when export-star branches provide ambiguous bindings", () => {
    writeProjectManifest();
    writeFile("src/first.ts", "export const helper = () => 1;");
    writeFile("src/second.ts", "export const helper = () => 2;");
    writeFile("src/index.ts", "export * from './first';\nexport * from './second';");
    const entryFile = writeEntryFile();
    expect(resolveCrossFileExport(entryFile, "./index", "helper")).toBeNull();
  });

  it("resolves through a tsconfig paths alias specifier", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    const target = writeFile("src/lib/format.ts", "export const format = (value) => `${value}`;");
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "@/lib/format", "format");
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.kind).toBe("function");
  });

  it("resolves an alias from a monorepo root tsconfig across a nested package boundary", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./shared/*"] } } }),
    );
    writeFile("apps/web/package.json", JSON.stringify({ name: "web", type: "module" }));
    const target = writeFile("shared/format.ts", "export const format = (value) => `${value}`;");
    const entryFile = writeFile("apps/web/src/app.tsx", "export const App = () => null;");

    expect(resolveCrossFileExport(entryFile, "@/format", "format")?.filePath).toBe(target);
  });

  it("resolves a ./x.js re-export hop landing on x.ts (extensionAlias)", () => {
    writeProjectManifest();
    const target = writeFile("src/helper.ts", "export const helper = () => 1;");
    writeFile("src/index.ts", "export { helper } from './helper.js';");
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./index", "helper");
    expect(resolved?.filePath).toBe(target);
  });

  it("returns null for a bare specifier into node_modules", () => {
    writeProjectManifest();
    writeFile(
      "node_modules/some-package/package.json",
      JSON.stringify({ name: "some-package", main: "index.js" }),
    );
    writeFile("node_modules/some-package/index.js", "export const helper = () => 1;");
    const entryFile = writeEntryFile();
    expect(resolveCrossFileExport(entryFile, "some-package", "helper")).toBeNull();
  });

  it("returns null for an unresolvable specifier", () => {
    writeProjectManifest();
    const entryFile = writeEntryFile();
    expect(resolveCrossFileExport(entryFile, "./does-not-exist", "helper")).toBeNull();
  });

  it("returns null when fromFilename is not absolute", () => {
    writeProjectManifest();
    writeFile("src/helper.ts", "export const helper = () => 1;");
    expect(resolveCrossFileExport("src/app.tsx", "./helper", "helper")).toBeNull();
  });

  it("returns null when the export name doesn't exist in the resolved file", () => {
    writeProjectManifest();
    writeFile("src/helper.ts", "export const helper = () => 1;");
    const entryFile = writeEntryFile();
    expect(resolveCrossFileExport(entryFile, "./helper", "missing")).toBeNull();
  });

  it("terminates on a re-export cycle and returns null", () => {
    writeProjectManifest();
    writeFile("src/a.ts", "export { helper } from './b';");
    writeFile("src/b.ts", "export { helper } from './a';");
    const entryFile = writeEntryFile();
    expect(resolveCrossFileExport(entryFile, "./a", "helper")).toBeNull();
  });

  it("stops at the depth cap on a long re-export chain", () => {
    writeProjectManifest();
    const chainLength = CROSS_FILE_BARREL_FOLLOW_DEPTH + 2;
    writeFile(`src/hop-${chainLength}.ts`, "export const helper = () => 1;");
    for (let hop = chainLength - 1; hop >= 0; hop--) {
      writeFile(`src/hop-${hop}.ts`, `export { helper } from './hop-${hop + 1}';`);
    }
    const entryFile = writeEntryFile();
    expect(resolveCrossFileExport(entryFile, "./hop-0", "helper")).toBeNull();
  });

  it("resolves a chain just under the depth cap", () => {
    writeProjectManifest();
    const lastHop = CROSS_FILE_BARREL_FOLLOW_DEPTH - 1;
    const target = writeFile(`src/hop-${lastHop}.ts`, "export const helper = () => 1;");
    for (let hop = lastHop - 1; hop >= 0; hop--) {
      writeFile(`src/hop-${hop}.ts`, `export { helper } from './hop-${hop + 1}';`);
    }
    const entryFile = writeEntryFile();
    expect(resolveCrossFileExport(entryFile, "./hop-0", "helper")?.filePath).toBe(target);
  });

  it("follows a re-export past a same-named local decoy declaration", () => {
    writeProjectManifest();
    const target = writeFile(
      "src/impl.ts",
      "export const buildShareUrl = async () => { await fetch('/share'); };",
    );
    writeFile(
      "src/barrel.ts",
      "const buildShareUrl = () => '/local-decoy';\nvoid buildShareUrl;\nexport { buildShareUrl } from './impl';",
    );
    const entryFile = writeEntryFile();
    const resolved = resolveCrossFileExport(entryFile, "./barrel", "buildShareUrl");
    expect(resolved?.filePath).toBe(target);
  });

  it("does not resolve individual names through `export * as ns`", () => {
    writeProjectManifest();
    writeFile("src/impl.ts", "export const helper = () => 1;");
    writeFile("src/barrel.ts", "export * as internal from './impl';");
    const entryFile = writeEntryFile();
    expect(resolveCrossFileExport(entryFile, "./barrel", "helper")).toBeNull();
    expect(resolveCrossFileExport(entryFile, "./barrel", "internal")).toBeNull();
  });
});
