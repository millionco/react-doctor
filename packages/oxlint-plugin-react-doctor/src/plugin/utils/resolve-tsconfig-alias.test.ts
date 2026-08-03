import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../constants/thresholds.js";
import { collectCrossFileProbes } from "./cross-file-probe-recorder.js";
import {
  __clearTsconfigAliasCacheForTests,
  resetTsconfigAliasCaches,
  resolveTsconfigAliasPath,
} from "./resolve-tsconfig-alias.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-alias-"));
  __clearTsconfigAliasCacheForTests();
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

describe("resolveTsconfigAliasPath", () => {
  it("resolves a `@/*` alias relative to baseUrl", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    const target = writeFile("src/components/Search.tsx", "export const Search = () => null;");
    const fromFile = path.join(temporaryDirectory, "src/app/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "@/components/Search")).toBe(target);
  });

  it("resolves paths without an explicit baseUrl (relative to the tsconfig dir)", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "~/*": ["./app/*"] } } }),
    );
    const target = writeFile("app/widgets/Bar.tsx", "export const Bar = () => null;");
    const fromFile = path.join(temporaryDirectory, "app/routes/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "~/widgets/Bar")).toBe(target);
  });

  it("parses JSONC tsconfig with comments and trailing commas", () => {
    writeFile(
      "tsconfig.json",
      `{
        // editor settings
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@/*": ["./src/*"], /* app alias */
          },
        },
      }`,
    );
    const target = writeFile("src/Thing.tsx", "export const Thing = () => null;");
    const fromFile = path.join(temporaryDirectory, "src/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "@/Thing")).toBe(target);
  });

  it("follows `extends` to inherit paths from a base config", () => {
    writeFile(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    writeFile("tsconfig.json", JSON.stringify({ extends: "./tsconfig.base.json" }));
    const target = writeFile("src/Deep.tsx", "export const Deep = () => null;");
    const fromFile = path.join(temporaryDirectory, "src/app/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "@/Deep")).toBe(target);
  });

  it("inherits paths from an extended base when the child declares only baseUrl", () => {
    writeFile(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    writeFile(
      "tsconfig.json",
      JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { baseUrl: "." } }),
    );
    const target = writeFile("src/Only.tsx", "export const Only = () => null;");
    const fromFile = path.join(temporaryDirectory, "src/app/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "@/Only")).toBe(target);
  });

  it("treats an explicit empty `paths` as replacing the base (no aliases)", () => {
    writeFile(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    writeFile(
      "tsconfig.json",
      JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { paths: {} } }),
    );
    writeFile("src/Only.tsx", "export const Only = () => null;");
    const fromFile = path.join(temporaryDirectory, "src/app/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "@/Only")).toBeNull();
  });

  it("returns null for a bare specifier that matches no alias", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    const fromFile = path.join(temporaryDirectory, "src/app/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "react")).toBeNull();
  });

  it("picks up tsconfig edits after scan caches reset", () => {
    const tsconfigPath = writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./old/*"] } } }),
    );
    const oldTarget = writeFile("old/Thing.tsx", "export const Thing = () => null;");
    const fromFile = path.join(temporaryDirectory, "src/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "@/Thing")).toBe(oldTarget);

    const newTarget = writeFile("fresh/Thing.tsx", "export const Thing = () => null;");
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./fresh/*"] } } }),
    );
    // Force a distinct mtime so the change is observable on coarse clocks.
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(tsconfigPath, future, future);

    resetTsconfigAliasCaches();
    expect(resolveTsconfigAliasPath(fromFile, "@/Thing")).toBe(newTarget);
  });

  it("reuses probe-time directory lookups until scan caches reset", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./old/*"] } } }),
    );
    const oldTarget = writeFile("old/Thing.tsx", "export const Thing = () => null;");
    const fromFile = path.join(temporaryDirectory, "src/features/page.tsx");
    const collectResolution = () => {
      let result: string | null = null;
      const trace = collectCrossFileProbes(() => {
        result = resolveTsconfigAliasPath(fromFile, "@/Thing");
      });
      return { result, trace };
    };

    const first = collectResolution();
    expect(first.result).toBe(oldTarget);

    writeFile(
      "src/tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./fresh/*"] } } }),
    );
    const freshTarget = writeFile("src/fresh/Thing.tsx", "export const Thing = () => null;");

    const siblingFromFile = path.join(temporaryDirectory, "src/other/page.tsx");
    const collectSiblingResolution = () => {
      let result: string | null = null;
      const trace = collectCrossFileProbes(() => {
        result = resolveTsconfigAliasPath(siblingFromFile, "@/Thing");
      });
      return { result, trace };
    };

    const cached = collectSiblingResolution();
    expect(cached.result).toBe(oldTarget);
    expect(cached.trace.contentPaths).toEqual(
      new Set([
        path.join(temporaryDirectory, "src/other/tsconfig.json"),
        path.join(temporaryDirectory, "src/other/jsconfig.json"),
        path.join(temporaryDirectory, "src/tsconfig.json"),
        path.join(temporaryDirectory, "src/jsconfig.json"),
        path.join(temporaryDirectory, "tsconfig.json"),
      ]),
    );

    resetTsconfigAliasCaches();
    const refreshed = collectSiblingResolution();
    expect(refreshed.result).toBe(freshTarget);
    expect(
      refreshed.trace.contentPaths.has(path.join(temporaryDirectory, "src/tsconfig.json")),
    ).toBe(true);
    expect(refreshed.trace.contentPaths.has(path.join(temporaryDirectory, "tsconfig.json"))).toBe(
      false,
    );
  });

  it("returns null when no tsconfig is found", () => {
    const fromFile = path.join(temporaryDirectory, "src/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "@/anything")).toBeNull();
  });

  it("preserves the directory walk limit when reusing an ancestor lookup", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    const target = writeFile("src/Thing.tsx", "export const Thing = () => null;");
    const directorySegments = Array.from(
      { length: CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS - 1 },
      (_, index) => `level-${index}`,
    );
    const cachedAncestorFile = path.join(temporaryDirectory, ...directorySegments, "page.tsx");
    expect(resolveTsconfigAliasPath(cachedAncestorFile, "@/Thing")).toBe(target);

    const deeperFile = path.join(
      temporaryDirectory,
      ...directorySegments,
      "beyond-limit",
      "page.tsx",
    );
    expect(resolveTsconfigAliasPath(deeperFile, "@/Thing")).toBeNull();
  });

  it("does not path-compress an incomplete directory walk", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    const target = writeFile("src/Thing.tsx", "export const Thing = () => null;");
    const directorySegments = Array.from(
      { length: CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS },
      (_, index) => `level-${index}`,
    );
    const beyondLimitFile = path.join(temporaryDirectory, ...directorySegments, "page.tsx");
    expect(resolveTsconfigAliasPath(beyondLimitFile, "@/Thing")).toBeNull();

    const withinLimitFile = path.join(
      temporaryDirectory,
      ...directorySegments.slice(0, -1),
      "page.tsx",
    );
    expect(resolveTsconfigAliasPath(withinLimitFile, "@/Thing")).toBe(target);
  });
});
