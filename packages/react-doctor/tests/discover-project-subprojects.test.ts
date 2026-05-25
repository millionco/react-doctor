import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { discoverProject, discoverReactSubprojects, formatFrameworkName } from "@react-doctor/core";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-discover-more-"));

afterAll(() => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("discoverReactSubprojects", () => {
  it("skips subdirectories where package.json is a directory (EISDIR)", () => {
    const rootDirectory = path.join(tempDirectory, "eisdir-package-json");
    const subdirectory = path.join(rootDirectory, "broken-sub");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.mkdirSync(path.join(subdirectory, "package.json"), { recursive: true });

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("my-app");
  });

  it("includes root directory when it has a react dependency", () => {
    const rootDirectory = path.join(tempDirectory, "root-with-react");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toContainEqual({ name: "my-app", directory: rootDirectory });
  });

  it("includes both root and subdirectory when both have react", () => {
    const rootDirectory = path.join(tempDirectory, "root-and-sub");
    const subdirectory = path.join(rootDirectory, "extension");
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(
      path.join(subdirectory, "package.json"),
      JSON.stringify({ name: "my-extension", dependencies: { react: "^18.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(2);
    expect(packages[0]).toEqual({ name: "my-app", directory: rootDirectory });
    expect(packages[1]).toEqual({ name: "my-extension", directory: subdirectory });
  });

  it("includes deeply nested React packages", () => {
    const rootDirectory = path.join(tempDirectory, "deep-react-package");
    const subdirectory = path.join(rootDirectory, "apps", "web");
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.writeFileSync(
      path.join(subdirectory, "package.json"),
      JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toContainEqual({ name: "web", directory: subdirectory });
  });

  it("prefers pnpm workspace packages over filesystem recursion", () => {
    const rootDirectory = path.join(tempDirectory, "pnpm-workspace-preferred");
    const workspaceDirectory = path.join(rootDirectory, "apps", "web");
    const unlistedDirectory = path.join(rootDirectory, "examples", "preview");
    fs.mkdirSync(workspaceDirectory, { recursive: true });
    fs.mkdirSync(unlistedDirectory, { recursive: true });
    fs.writeFileSync(path.join(rootDirectory, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    fs.writeFileSync(
      path.join(workspaceDirectory, "package.json"),
      JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(
      path.join(unlistedDirectory, "package.json"),
      JSON.stringify({ name: "preview", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toEqual([{ name: "web", directory: workspaceDirectory }]);
  });

  it("skips ignored generated directories during filesystem recursion", () => {
    const rootDirectory = path.join(tempDirectory, "ignored-generated-directories");
    const ignoredDirectory = path.join(rootDirectory, "node_modules", "preview");
    fs.mkdirSync(ignoredDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(ignoredDirectory, "package.json"),
      JSON.stringify({ name: "preview", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(0);
  });

  it("does not match packages with only @types/react", () => {
    const rootDirectory = path.join(tempDirectory, "types-only");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "types-only", devDependencies: { "@types/react": "^18.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(0);
  });

  it("matches packages with react-native dependency", () => {
    const rootDirectory = path.join(tempDirectory, "rn-app");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "rn-app", dependencies: { "react-native": "^0.74.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
  });

  it("handles nonexistent root directory without crashing", () => {
    const packages = discoverReactSubprojects("/nonexistent/path/that/doesnt/exist");
    expect(packages).toHaveLength(0);
  });

  it("skips subdirectory entries that are files instead of directories", () => {
    const rootDirectory = path.join(tempDirectory, "file-as-subdir");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(path.join(rootDirectory, "not-a-dir"), "just a file");

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("my-app");
  });
});

describe("discoverProject — hasReactNativeWorkspace", () => {
  it("is true when the entry-point package itself declares `react-native`", () => {
    const projectDirectory = path.join(tempDirectory, "rn-aware-self");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "mobile-app",
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when the entry-point package declares `expo`", () => {
    const projectDirectory = path.join(tempDirectory, "rn-aware-expo");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "expo-app",
        dependencies: { react: "^19.0.0", expo: "^51.0.0", "expo-router": "^3.5.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when a workspace sibling declares `react-native` even if the root is web-only (inverted-gate fixture)", () => {
    // Root `package.json` is Next.js-shaped; `apps/mobile` is an Expo
    // workspace. The capability gate in `buildCapabilities` keys off
    // this bit so `rn-*` rules still load on `apps/mobile` despite
    // the root framework being `nextjs`. Without the workspace walk
    // the bit would be `false` and every `rn-*` rule would be
    // dropped at the project level before the file-level wrapper
    // could ever silence them.
    const rootDirectory = path.join(tempDirectory, "inverted-monorepo");
    const webDirectory = path.join(rootDirectory, "apps", "web");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "inverted-monorepo",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { react: "^19.0.0", "react-native": "0.76.0", expo: "^51.0.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when a workspace lists `react-native` only in `optionalDependencies` (parity with the file-level classifier)", () => {
    // pinned because the project-info predicate previously only
    // walked `dependencies` / `devDependencies` / `peerDependencies`
    // while the oxlint plugin's `classifyPackagePlatform` also walks
    // `optionalDependencies`. The drift meant a workspace with
    // `react-native` in optionalDependencies would classify as RN
    // for the file-level rule gate but stay invisible to the
    // project-level capability gate, dropping every `rn-*` rule.
    const rootDirectory = path.join(tempDirectory, "inverted-monorepo-opt-deps");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "opt-deps-root",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { react: "^19.0.0" },
        optionalDependencies: { "react-native": "0.76.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when a workspace declares only an `@react-native-*` namespace dependency (prefix match)", () => {
    const rootDirectory = path.join(tempDirectory, "inverted-monorepo-namespace");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "namespace-root",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { react: "^19.0.0", "@react-native-firebase/app": "^21.0.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when a workspace library sets Metro's top-level `react-native` resolution field", () => {
    const rootDirectory = path.join(tempDirectory, "inverted-monorepo-metro-field");
    const libDirectory = path.join(rootDirectory, "packages", "native-lib");
    fs.mkdirSync(libDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "metro-field-root",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["packages/*"],
      }),
    );
    fs.writeFileSync(
      path.join(libDirectory, "package.json"),
      JSON.stringify({
        name: "native-lib",
        dependencies: { react: "^19.0.0" },
        "react-native": "./dist/native/index.js",
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is false on a pure web monorepo where no workspace declares any RN dependency", () => {
    const rootDirectory = path.join(tempDirectory, "pure-web-monorepo");
    const webDirectory = path.join(rootDirectory, "apps", "web");
    const docsDirectory = path.join(rootDirectory, "apps", "docs");
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.mkdirSync(docsDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "pure-web",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(docsDirectory, "package.json"),
      JSON.stringify({
        name: "docs",
        dependencies: { "@docusaurus/core": "^3.4.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(false);
  });

  it("is false on a single-package web project (no workspaces, no RN deps)", () => {
    const projectDirectory = path.join(tempDirectory, "single-web-app");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "single-web",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(false);
  });
});

describe("formatFrameworkName", () => {
  it("formats known frameworks", () => {
    expect(formatFrameworkName("nextjs")).toBe("Next.js");
    expect(formatFrameworkName("vite")).toBe("Vite");
    expect(formatFrameworkName("cra")).toBe("Create React App");
    expect(formatFrameworkName("remix")).toBe("Remix");
    expect(formatFrameworkName("gatsby")).toBe("Gatsby");
  });

  it("formats unknown framework as React", () => {
    expect(formatFrameworkName("unknown")).toBe("React");
  });
});
