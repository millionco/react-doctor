import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { checkReactNativeProject, clearPackageJsonCache } from "@react-doctor/core";
import type { Diagnostic, PackageJson, ProjectInfo } from "@react-doctor/core";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rn-checks-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

let directoryCounter = 0;
const makeProjectDirectory = (): string => {
  const projectDirectory = path.join(tempRoot, `project-${directoryCounter++}`);
  fs.mkdirSync(projectDirectory, { recursive: true });
  return projectDirectory;
};

const writePackageJson = (projectDirectory: string, packageJson: PackageJson): void => {
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );
  clearPackageJsonCache();
};

const writeFile = (projectDirectory: string, fileName: string, contents: string): void => {
  fs.writeFileSync(path.join(projectDirectory, fileName), contents);
};

const buildRnProject = (
  rootDirectory: string,
  framework: ProjectInfo["framework"] = "react-native",
): ProjectInfo => ({
  rootDirectory,
  projectName: "rn-app",
  reactVersion: "18.2.0",
  reactMajorVersion: 18,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework,
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: framework === "react-native" || framework === "expo",
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 10,
});

const rulesOf = (diagnostics: ReadonlyArray<Diagnostic>): string[] =>
  diagnostics.map((diagnostic) => diagnostic.rule);

describe("checkReactNativeProject — gating", () => {
  it("emits nothing for a non-React-Native project", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "web-app", dependencies: { react: "18.2.0" } });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:metro-react-native-babel-preset'] };`,
    );
    expect(
      checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory, "vite")),
    ).toEqual([]);
  });
});

describe("checkReactNativeProject — legacy metro babel preset", () => {
  it("flags the renamed metro-react-native-babel-preset", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.72.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:metro-react-native-babel-preset'] };`,
    );
    const diagnostics = checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory));
    const hit = diagnostics.find((d) => d.rule === "rn-no-metro-babel-preset");
    expect(hit).toBeDefined();
    // A broken build transform must surface by default (errors aren't hidden).
    expect(hit?.severity).toBe("error");
  });

  it("does NOT flag the current @react-native/babel-preset", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:@react-native/babel-preset'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-preset");
  });

  it("does NOT flag a bare mention in a comment (no module: prefix)", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `// historically used metro-react-native-babel-preset; now on @react-native/babel-preset\nmodule.exports = { presets: ['module:@react-native/babel-preset'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-preset");
  });
});

describe("checkReactNativeProject — library react in dependencies", () => {
  const libraryPackageJson = (overrides: Partial<PackageJson>): PackageJson =>
    ({
      name: "my-rn-lib",
      "react-native-builder-bob": { source: "src", output: "lib" },
      ...overrides,
    }) as unknown as PackageJson;

  it("flags a builder-bob library with react-native in dependencies", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(
      projectDirectory,
      libraryPackageJson({ dependencies: { "react-native": "0.74.0" } }),
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).toContain("rn-library-react-in-dependencies");
  });

  it("flags a builder-bob library with react in dependencies", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, libraryPackageJson({ dependencies: { react: "18.2.0" } }));
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).toContain("rn-library-react-in-dependencies");
  });

  it("does NOT flag a bob library that keeps react-native in peerDependencies", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(
      projectDirectory,
      libraryPackageJson({
        peerDependencies: { "react-native": "*", react: "*" },
        devDependencies: { "react-native-builder-bob": "^0.30.0", "react-native": "0.74.0" },
      }),
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-library-react-in-dependencies");
  });

  // Regression (RDE eval): a library monorepo's `example/` app lists bob in
  // its devDependencies (to build the local lib) and depends on react-native —
  // but has NO bob config block, so it must not be flagged as a library.
  it("does NOT flag the example app (bob in devDeps, no config block)", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "my-rn-lib-example",
      dependencies: { "react-native": "0.74.0", react: "18.2.0", expo: "~52.0.0" },
      devDependencies: { "react-native-builder-bob": "^0.30.0" },
    });
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-library-react-in-dependencies");
  });

  it("does NOT flag a normal app (no builder-bob) with react-native in dependencies", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.74.0", react: "18.2.0" },
    });
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-library-react-in-dependencies");
  });
});
