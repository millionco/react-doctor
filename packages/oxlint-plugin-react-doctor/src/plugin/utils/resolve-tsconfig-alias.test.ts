import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  __clearTsconfigAliasCacheForTests,
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

  it("picks up tsconfig edits within a long-lived process (no stale directory cache)", () => {
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

    expect(resolveTsconfigAliasPath(fromFile, "@/Thing")).toBe(newTarget);
  });

  it("returns null when no tsconfig is found", () => {
    const fromFile = path.join(temporaryDirectory, "src/page.tsx");
    expect(resolveTsconfigAliasPath(fromFile, "@/anything")).toBeNull();
  });
});
