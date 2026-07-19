import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { discoverProject } from "@react-doctor/core";

// Characterization pins for the single-pass discovery rewrite: each case
// snapshots the FULL ProjectInfo for a realistic workspace shape, so the
// rewrite commit must reproduce every field bit-for-bit. Fixtures are
// designed to be traversal-order-independent (react merges lowest-major,
// predicates are any-of, spec facts have one declaring workspace), so the
// pins hold across the legacy unsorted walk and the sorted single pass.

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-characterization-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

interface FixtureFile {
  readonly filePath: string;
  readonly contents: string;
}

const writeFixture = (name: string, files: ReadonlyArray<FixtureFile>): string => {
  const fixtureDirectory = path.join(temporaryRoot, name);
  for (const { filePath, contents } of files) {
    const absolutePath = path.join(fixtureDirectory, filePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
  }
  return fixtureDirectory;
};

const packageJson = (contents: object): string => JSON.stringify(contents, null, 2);

describe("discoverProject characterization — workspace fixture matrix", () => {
  it("pnpm monorepo with named catalogs: workspace react via catalog:react19", () => {
    const fixtureDirectory = writeFixture("pnpm-named-catalogs", [
      {
        filePath: "package.json",
        contents: packageJson({ name: "pnpm-catalogs-root", private: true }),
      },
      {
        filePath: "pnpm-workspace.yaml",
        contents: [
          "packages:",
          '  - "apps/*"',
          "catalogs:",
          "  react18:",
          "    react: 18.3.1",
          "  react19:",
          "    react: 19.1.0",
          "    zod: 4.1.0",
          "",
        ].join("\n"),
      },
      {
        filePath: "apps/web/package.json",
        contents: packageJson({
          name: "web",
          dependencies: { react: "catalog:react19", next: "15.3.0", zod: "catalog:react19" },
        }),
      },
    ]);

    expect(discoverProject(fixtureDirectory)).toEqual({
      rootDirectory: fixtureDirectory,
      projectName: "pnpm-catalogs-root",
      reactVersion: "19.1.0",
      reactMajorVersion: 19,
      tailwindVersion: null,
      zodVersion: "4.1.0",
      zodMajorVersion: 4,
      mobxVersion: null,
      mobxMajorVersion: null,
      hasMobxReact: false,
      hasMobxReactLite: false,
      hasMobxStateTree: false,
      hasMobxReactObserver: false,
      zustandVersion: null,
      zustandMajorVersion: null,
      framework: "nextjs",
      hasTypeScript: false,
      hasReactCompiler: false,
      hasReactCompilerLintPlugin: false,
      hasTanStackQuery: false,
      valtioVersion: null,
      valtioMajorVersion: null,
      hasRemotion: false,
      remotionVersion: null,
      remotionMajorVersion: null,
      hasSsrDependency: false,
      preactVersion: null,
      preactMajorVersion: null,
      hasReactNativeWorkspace: false,
      nextjsVersion: "15.3.0",
      nextjsMajorVersion: 15,
      expoVersion: null,
      shopifyFlashListVersion: null,
      shopifyFlashListMajorVersion: null,
      hasReanimated: false,
      reanimatedVersion: null,
      isPreES2023Target: false,
      isStaticExport: false,
      sourceFileCount: 0,
    });
  });

  it("yarn-workspaces web monorepo with a React Native workspace: RN facts surface, web framework wins", () => {
    const fixtureDirectory = writeFixture("web-monorepo-with-rn", [
      {
        filePath: "package.json",
        contents: packageJson({
          name: "web-monorepo",
          private: true,
          workspaces: ["apps/*"],
          dependencies: { react: "^19.0.0", next: "^15.0.0" },
        }),
      },
      {
        filePath: "apps/mobile/package.json",
        contents: packageJson({
          name: "mobile",
          dependencies: {
            expo: "~52.0.0",
            react: "18.3.1",
            "react-native": "0.76.0",
            "react-native-reanimated": "~3.16.0",
            "@shopify/flash-list": "1.7.1",
          },
        }),
      },
    ]);

    expect(discoverProject(fixtureDirectory)).toEqual({
      rootDirectory: fixtureDirectory,
      projectName: "web-monorepo",
      // The root's own react wins (the workspace walk never runs when the
      // root resolves react + framework) — the piggyback quirk under test.
      reactVersion: "^19.0.0",
      reactMajorVersion: 19,
      tailwindVersion: null,
      zodVersion: null,
      zodMajorVersion: null,
      mobxVersion: null,
      mobxMajorVersion: null,
      hasMobxReact: false,
      hasMobxReactLite: false,
      hasMobxStateTree: false,
      hasMobxReactObserver: false,
      zustandVersion: null,
      zustandMajorVersion: null,
      framework: "nextjs",
      hasTypeScript: false,
      hasReactCompiler: false,
      hasReactCompilerLintPlugin: false,
      hasTanStackQuery: false,
      valtioVersion: null,
      valtioMajorVersion: null,
      hasRemotion: false,
      remotionVersion: null,
      remotionMajorVersion: null,
      hasSsrDependency: false,
      preactVersion: null,
      preactMajorVersion: null,
      hasReactNativeWorkspace: true,
      nextjsVersion: "^15.0.0",
      nextjsMajorVersion: 15,
      expoVersion: "~52.0.0",
      shopifyFlashListVersion: "1.7.1",
      shopifyFlashListMajorVersion: 1,
      hasReanimated: true,
      reanimatedVersion: "~3.16.0",
      isPreES2023Target: false,
      isStaticExport: false,
      sourceFileCount: 0,
    });
  });

  it("tailwind piggyback quirk: a root-resolved project never picks workspace tailwind", () => {
    const fixtureDirectory = writeFixture("tailwind-piggyback-skip", [
      {
        filePath: "package.json",
        contents: packageJson({
          name: "root-resolved",
          workspaces: ["packages/*"],
          dependencies: { react: "^19.0.0", next: "^15.0.0" },
        }),
      },
      {
        filePath: "packages/ui/package.json",
        contents: packageJson({
          name: "ui",
          dependencies: { tailwindcss: "^3.4.0", zod: "^3.23.0" },
        }),
      },
    ]);

    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.tailwindVersion).toBe(null);
    expect(projectInfo.zodVersion).toBe(null);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
    expect(projectInfo.framework).toBe("nextjs");
  });

  it("surfaces a Remotion dependency from a workspace package", () => {
    const fixtureDirectory = writeFixture("remotion-workspace", [
      {
        filePath: "package.json",
        contents: packageJson({
          name: "remotion-root",
          private: true,
          workspaces: ["apps/*"],
        }),
      },
      {
        filePath: "apps/video/package.json",
        contents: packageJson({
          name: "video",
          dependencies: { react: "19.1.0", remotion: "4.0.420", vite: "^7.0.0" },
        }),
      },
    ]);

    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.hasRemotion).toBe(true);
    expect(projectInfo.remotionVersion).toBe("4.0.420");
    expect(projectInfo.remotionMajorVersion).toBe(4);
    expect(projectInfo.framework).toBe("vite");
  });

  it("uses the oldest Remotion major across a mixed-version workspace", () => {
    const fixtureDirectory = writeFixture("mixed-remotion-workspace", [
      {
        filePath: "package.json",
        contents: packageJson({
          name: "remotion-root",
          private: true,
          workspaces: ["apps/*"],
          dependencies: { remotion: "^4.0.0" },
        }),
      },
      {
        filePath: "apps/legacy/package.json",
        contents: packageJson({ name: "legacy-video", dependencies: { remotion: "^3.3.0" } }),
      },
    ]);

    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.hasRemotion).toBe(true);
    expect(projectInfo.remotionVersion).toBe("^3.3.0");
    expect(projectInfo.remotionMajorVersion).toBe(3);
  });

  it("suppresses the Remotion major when any workspace version is unresolved", () => {
    const fixtureDirectory = writeFixture("unresolved-remotion-workspace", [
      {
        filePath: "package.json",
        contents: packageJson({
          name: "remotion-root",
          private: true,
          workspaces: ["apps/*"],
          dependencies: { remotion: "^4.0.0" },
        }),
      },
      {
        filePath: "apps/video/package.json",
        contents: packageJson({
          name: "video",
          dependencies: { remotion: "workspace:*" },
        }),
      },
    ]);

    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.hasRemotion).toBe(true);
    expect(projectInfo.remotionVersion).toBe(null);
    expect(projectInfo.remotionMajorVersion).toBe(null);
  });

  it("nx workspace: react + framework detected from an app project", () => {
    const fixtureDirectory = writeFixture("nx-workspace", [
      { filePath: "package.json", contents: packageJson({ name: "nx-root", private: true }) },
      { filePath: "nx.json", contents: packageJson({}) },
      {
        filePath: "apps/site/package.json",
        contents: packageJson({
          name: "site",
          dependencies: { react: "18.2.0", "react-scripts": "5.0.1" },
        }),
      },
    ]);

    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.reactVersion).toBe("18.2.0");
    expect(projectInfo.reactMajorVersion).toBe(18);
    expect(projectInfo.framework).toBe("cra");
  });

  it("react lowest-major merge across workspaces (order-independent)", () => {
    const fixtureDirectory = writeFixture("lowest-react-major", [
      {
        filePath: "package.json",
        contents: packageJson({ name: "multi-react", private: true, workspaces: ["packages/*"] }),
      },
      {
        filePath: "packages/legacy/package.json",
        contents: packageJson({ name: "legacy", dependencies: { react: "18.2.0" } }),
      },
      {
        filePath: "packages/modern/package.json",
        contents: packageJson({ name: "modern", dependencies: { react: "19.1.0" } }),
      },
    ]);

    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.reactVersion).toBe("18.2.0");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("overlapping workspace globs resolve each package once", () => {
    const fixtureDirectory = writeFixture("overlapping-globs", [
      {
        filePath: "package.json",
        contents: packageJson({
          name: "overlap-root",
          private: true,
          workspaces: ["packages/*", "packages/app"],
        }),
      },
      {
        filePath: "packages/app/package.json",
        contents: packageJson({
          name: "app",
          dependencies: { react: "19.1.0", vite: "^6.0.0" },
        }),
      },
    ]);

    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.reactVersion).toBe("19.1.0");
    expect(projectInfo.framework).toBe("vite");
  });

  it("leaf scan inside a catalog monorepo resolves through the monorepo root", () => {
    const fixtureDirectory = writeFixture("leaf-in-monorepo", [
      {
        filePath: "package.json",
        contents: packageJson({ name: "catalog-monorepo", private: true }),
      },
      {
        filePath: "pnpm-workspace.yaml",
        contents: ["packages:", '  - "apps/*"', "catalog:", "  react: 19.1.0", ""].join("\n"),
      },
      {
        filePath: "apps/web/package.json",
        contents: packageJson({
          name: "leaf-web",
          dependencies: { react: "catalog:", next: "15.1.0" },
        }),
      },
    ]);

    const projectInfo = discoverProject(path.join(fixtureDirectory, "apps", "web"));
    expect(projectInfo.projectName).toBe("leaf-web");
    expect(projectInfo.reactVersion).toBe("19.1.0");
    expect(projectInfo.reactMajorVersion).toBe(19);
    expect(projectInfo.framework).toBe("nextjs");
    expect(projectInfo.nextjsVersion).toBe("15.1.0");
    expect(projectInfo.nextjsMajorVersion).toBe(15);
  });

  it("records concrete SSR runtime evidence in a Vite project", () => {
    const fixtureDirectory = writeFixture("vite-react-router-ssr", [
      {
        filePath: "package.json",
        contents: packageJson({
          name: "vite-react-router-ssr",
          dependencies: {
            react: "^19.0.0",
            vite: "^7.0.0",
            "@react-router/node": "^7.0.0",
          },
        }),
      },
    ]);

    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.framework).toBe("vite");
    expect(projectInfo.hasSsrDependency).toBe(true);
  });
});
