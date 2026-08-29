import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createResolver } from "../src/project-analysis/resolver/resolve.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
): string => {
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "react-doctor-resolver-test-"),
  );
  temporaryDirectories.push(rootDirectory);
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

describe("resolver directory index resolution", () => {
  it("resolves directory path with tsconfig alias to index.ts", () => {
    const rootDirectory = createProject({
      "src/screens/bar.tsx": `import { FooList } from "@/features/foo";`,
      "src/features/foo/index.ts": `export * from "./foo-list";`,
      "src/features/foo/foo-list.tsx": `export const FooList = () => <div>Foo List</div>;`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
      }),
    });

    const tsconfigPath = path.join(rootDirectory, "tsconfig.json");
    const resolver = createResolver(
      { rootDir: rootDirectory, tsConfigPath: tsconfigPath },
      [],
      {},
    );

    const importerPath = path.join(rootDirectory, "src/screens/bar.tsx");
    const resolved = resolver.resolveModule("@/features/foo", importerPath);

    expect(resolved.resolvedPath).toBeDefined();
    expect(resolved.resolvedPath).toMatch(/features\/foo\/index\.ts$/);
    expect(resolved.isExternal).toBe(false);
  });

  it("resolves directory path with moduleResolution bundler to index.ts", () => {
    const rootDirectory = createProject({
      "src/screens/bar.tsx": `import { FooList } from "@/features/foo";`,
      "src/features/foo/index.ts": `export * from "./foo-list";`,
      "src/features/foo/foo-list.tsx": `export const FooList = () => <div>Foo List</div>;`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
          moduleResolution: "bundler",
        },
      }),
    });

    const tsconfigPath = path.join(rootDirectory, "tsconfig.json");
    const resolver = createResolver(
      { rootDir: rootDirectory, tsConfigPath: tsconfigPath },
      [],
      {},
    );

    const importerPath = path.join(rootDirectory, "src/screens/bar.tsx");
    const resolved = resolver.resolveModule("@/features/foo", importerPath);

    expect(resolved.resolvedPath).toBeDefined();
    expect(resolved.resolvedPath).toMatch(/features\/foo\/index\.ts$/);
    expect(resolved.isExternal).toBe(false);
  });

  it("resolves directory path with baseUrl to index.ts", () => {
    const rootDirectory = createProject({
      "src/App.tsx": `import { FooList } from "features/foo";`,
      "src/features/foo/index.ts": `export * from "./foo-list";`,
      "src/features/foo/foo-list.tsx": `export const FooList = () => <div>Foo List</div>;`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "./src",
        },
      }),
    });

    const tsconfigPath = path.join(rootDirectory, "tsconfig.json");
    const resolver = createResolver(
      { rootDir: rootDirectory, tsConfigPath: tsconfigPath },
      [],
      {},
    );

    const importerPath = path.join(rootDirectory, "src/App.tsx");
    const resolved = resolver.resolveModule("features/foo", importerPath);

    expect(resolved.resolvedPath).toBeDefined();
    expect(resolved.resolvedPath).toMatch(/features\/foo\/index\.ts$/);
    expect(resolved.isExternal).toBe(false);
  });

  it("resolves relative directory path to index.ts", () => {
    const rootDirectory = createProject({
      "src/App.tsx": `import { FooList } from "./features/foo";`,
      "src/features/foo/index.ts": `export * from "./foo-list";`,
      "src/features/foo/foo-list.tsx": `export const FooList = () => <div>Foo List</div>;`,
    });

    const resolver = createResolver(
      { rootDir: rootDirectory },
      [],
      {},
    );

    const importerPath = path.join(rootDirectory, "src/App.tsx");
    const resolved = resolver.resolveModule("./features/foo", importerPath);

    expect(resolved.resolvedPath).toBeDefined();
    expect(resolved.resolvedPath).toMatch(/features\/foo\/index\.ts$/);
    expect(resolved.isExternal).toBe(false);
  });
});
