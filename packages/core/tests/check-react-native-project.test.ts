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
  const filePath = path.join(projectDirectory, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const buildRnProject = (
  rootDirectory: string,
  framework: ProjectInfo["framework"] = "react-native",
  overrides: Partial<ProjectInfo> = {},
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
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: framework === "react-native" || framework === "expo",
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  reanimatedVersion: null,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 10,
  ...overrides,
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
  it("flags the removed preset on React Native 0.73+ when it cannot resolve", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.73.0" },
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

  it("does NOT flag the preset before the React Native 0.73 rename", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "^0.72.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:metro-react-native-babel-preset'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-preset");
  });

  it("does NOT flag the preset on React Native 0.59", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "^0.59.10" },
      devDependencies: { "metro-react-native-babel-preset": "^0.52.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:metro-react-native-babel-preset'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-preset");
  });

  it("does NOT flag an explicitly installed legacy preset on modern React Native", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
      devDependencies: { "metro-react-native-babel-preset": "^0.77.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:metro-react-native-babel-preset'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-preset");
  });

  it("does NOT flag a resolvable transitive legacy preset", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    const legacyPresetDirectory = path.join(
      projectDirectory,
      "node_modules",
      "metro-react-native-babel-preset",
    );
    fs.mkdirSync(legacyPresetDirectory, { recursive: true });
    writePackageJson(legacyPresetDirectory, {
      name: "metro-react-native-babel-preset",
      version: "0.77.0",
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:metro-react-native-babel-preset'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-preset");
  });

  it("does NOT flag an unresolvable React Native version spec", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "catalog:" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:metro-react-native-babel-preset'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-preset");
  });

  it("does NOT flag a malformed non-string React Native version spec", () => {
    const projectDirectory = makeProjectDirectory();
    writeFile(
      projectDirectory,
      "package.json",
      JSON.stringify({ name: "rn-app", dependencies: { "react-native": 73 } }),
    );
    clearPackageJsonCache();
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['module:metro-react-native-babel-preset'] };`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-preset");
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

  it("flags the modern preset without the enableBabelRuntime option", () => {
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
    const diagnostics = checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory));
    const hit = diagnostics.find((d) => d.rule === "rn-no-metro-babel-runtime-version");
    expect(hit).toBeDefined();
    // A bundle-size optimization, not a broken build — advisory, never blocking.
    expect(hit?.severity).toBe("warning");
  });

  it("flags the modern preset when enableBabelRuntime is true (no version)", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: [['module:@react-native/babel-preset', { enableBabelRuntime: true }]] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).toContain("rn-no-metro-babel-runtime-version");
  });

  it("flags the modern preset when enableBabelRuntime is explicitly false", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: [['module:@react-native/babel-preset', { enableBabelRuntime: false }]] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).toContain("rn-no-metro-babel-runtime-version");
  });

  it("flags the modern preset even when enableBabelRuntime only appears in a comment", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `// TODO: set enableBabelRuntime\nmodule.exports = { presets: ['module:@react-native/babel-preset'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).toContain("rn-no-metro-babel-runtime-version");
  });

  it("does NOT flag the modern preset when enableBabelRuntime is set", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: [['module:@react-native/babel-preset', { enableBabelRuntime: '^7.26.0' }]] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-runtime-version");
  });

  it("does NOT flag a JSON babel config that sets enableBabelRuntime", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.json",
      `{ "presets": [["module:@react-native/babel-preset", { "enableBabelRuntime": "^7.26.0" }]] }`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-runtime-version");
  });

  it("does NOT flag an Expo babel config without the RN preset", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: ['babel-preset-expo'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-runtime-version");
  });

  it("does NOT flag an Expo config that only mentions the RN preset in a comment", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `// migrated off module:@react-native/babel-preset\nmodule.exports = { presets: ['babel-preset-expo'] };`,
    );
    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-no-metro-babel-runtime-version");
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

describe("checkReactNativeProject — Babel plugin order", () => {
  it("flags the removed Reanimated plugin in a Reanimated 4 project", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0", "react-native-reanimated": "^4.0.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ['react-native-reanimated/plugin'] };`,
    );
    const project = buildRnProject(projectDirectory, "react-native", {
      hasReanimated: true,
      reanimatedVersion: "^4.0.0",
    });

    expect(rulesOf(checkReactNativeProject(projectDirectory, project))).toContain(
      "rn-reanimated-worklets-plugin-last",
    );
  });

  it("flags both migration and ordering when legacy Reanimated and misplaced Worklets plugins coexist", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0", "react-native-reanimated": "^4.0.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ['react-native-reanimated/plugin', 'react-native-worklets/plugin', 'other-plugin'] };`,
    );
    const project = buildRnProject(projectDirectory, "react-native", {
      hasReanimated: true,
      reanimatedVersion: "^4.0.0",
    });

    const diagnostics = checkReactNativeProject(projectDirectory, project).filter(
      (diagnostic) => diagnostic.rule === "rn-reanimated-worklets-plugin-last",
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("still uses `react-native-reanimated/plugin`"),
        expect.stringContaining("`react-native-worklets/plugin` is not last"),
      ]),
    );
  });

  it("only flags migration when legacy Reanimated and final Worklets plugins coexist", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0", "react-native-reanimated": "^4.0.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ['react-native-reanimated/plugin', 'react-native-worklets/plugin'] };`,
    );
    const project = buildRnProject(projectDirectory, "react-native", {
      hasReanimated: true,
      reanimatedVersion: "^4.0.0",
    });

    const diagnostics = checkReactNativeProject(projectDirectory, project).filter(
      (diagnostic) => diagnostic.rule === "rn-reanimated-worklets-plugin-last",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("still uses `react-native-reanimated/plugin`");
  });

  it("does NOT flag the Reanimated plugin in a Reanimated 3 project", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.76.0", "react-native-reanimated": "^3.16.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ['react-native-reanimated/plugin'] };`,
    );
    const project = buildRnProject(projectDirectory, "react-native", {
      hasReanimated: true,
      reanimatedVersion: "^3.16.0",
    });

    expect(rulesOf(checkReactNativeProject(projectDirectory, project))).not.toContain(
      "rn-reanimated-worklets-plugin-last",
    );
  });

  it("does NOT fail when a legacy ProjectInfo omits reanimatedVersion", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ['react-native-reanimated/plugin'] };`,
    );
    const project = buildRnProject(projectDirectory);
    Reflect.deleteProperty(project, "reanimatedVersion");

    expect(rulesOf(checkReactNativeProject(projectDirectory, project))).not.toContain(
      "rn-reanimated-worklets-plugin-last",
    );
  });

  it("flags the Worklets plugin when it is not last", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0", "react-native-reanimated": "4.1.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ['react-native-worklets/plugin', 'other-plugin'] };`,
    );
    const project = buildRnProject(projectDirectory, "react-native", {
      hasReanimated: true,
      reanimatedVersion: "4.1.0",
    });

    expect(rulesOf(checkReactNativeProject(projectDirectory, project))).toContain(
      "rn-reanimated-worklets-plugin-last",
    );
  });

  it("does NOT flag the Worklets plugin when it is last", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0", "react-native-reanimated": "4.1.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ['other-plugin', ['react-native-worklets/plugin', {}]] };`,
    );
    const project = buildRnProject(projectDirectory, "react-native", {
      hasReanimated: true,
      reanimatedVersion: "4.1.0",
    });

    expect(rulesOf(checkReactNativeProject(projectDirectory, project))).not.toContain(
      "rn-reanimated-worklets-plugin-last",
    );
  });

  it.each([
    {
      title: "does NOT flag a final duplicate Worklets entry",
      plugins: ["react-native-worklets/plugin", "other-plugin", "react-native-worklets/plugin"],
      shouldReport: false,
    },
    {
      title: "flags a plugin after the last duplicate Worklets entry",
      plugins: [
        "react-native-worklets/plugin",
        "other-plugin",
        "react-native-worklets/plugin",
        "final-plugin",
      ],
      shouldReport: true,
    },
  ])("$title", ({ plugins, shouldReport }) => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0", "react-native-reanimated": "4.1.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ${JSON.stringify(plugins)} };`,
    );
    const project = buildRnProject(projectDirectory, "react-native", {
      hasReanimated: true,
      reanimatedVersion: "4.1.0",
    });

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, project)).includes(
        "rn-reanimated-worklets-plugin-last",
      ),
    ).toBe(shouldReport);
  });

  it("flags an explicitly configured React Compiler plugin that is not first", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
      devDependencies: { "babel-plugin-react-compiler": "1.0.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.mjs",
      `export default { plugins: ['other-plugin', ['babel-plugin-react-compiler', {}]] };`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).toContain("rn-react-compiler-plugin-first");
  });

  it("does NOT flag the React Compiler plugin when it is first", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { plugins: ['babel-plugin-react-compiler', 'other-plugin'] };`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-react-compiler-plugin-first");
  });

  it("flags compiler ordering in a static package.json Babel config", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
      babel: { plugins: ["other-plugin", "babel-plugin-react-compiler"] },
    });

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).toContain("rn-react-compiler-plugin-first");
  });

  it("does NOT infer plugin order from a dynamic plugin array", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0", "react-native-reanimated": "4.1.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `const plugins = ['other-plugin']; module.exports = { plugins: [...plugins, 'babel-plugin-react-compiler', 'react-native-worklets/plugin'] };`,
    );
    const project = buildRnProject(projectDirectory, "react-native", {
      hasReanimated: true,
      reanimatedVersion: "4.1.0",
    });
    const rules = rulesOf(checkReactNativeProject(projectDirectory, project));

    expect(rules).not.toContain("rn-react-compiler-plugin-first");
    expect(rules).not.toContain("rn-reanimated-worklets-plugin-last");
  });

  it("does NOT flag an Expo preset that configures the compiler automatically", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "^54.0.0", "react-native": "0.81.0" },
    });
    writeFile(
      projectDirectory,
      "babel.config.js",
      `module.exports = { presets: [['babel-preset-expo', { 'react-compiler': true }]] };`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory, "expo"))),
    ).not.toContain("rn-react-compiler-plugin-first");
  });
});

describe("checkReactNativeProject — Android release shrinking", () => {
  it("flags literal false values in a Groovy release block", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle",
      `android { buildTypes { release { minifyEnabled false\nshrinkResources false } } }`,
    );

    const diagnostic = checkReactNativeProject(
      projectDirectory,
      buildRnProject(projectDirectory),
    ).find((candidate) => candidate.rule === "rn-android-release-shrinking-disabled");
    expect(diagnostic?.message).toContain("code minification and resource shrinking");
    expect(diagnostic?.help).toContain("release code minification and resource shrinking");
    expect(diagnostic?.help).not.toContain("R8");
  });

  it("flags literal false values in a Kotlin release block", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle.kts",
      `android { buildTypes { getByName("release") { isMinifyEnabled = false\nisShrinkResources = true } } }`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).toContain("rn-android-release-shrinking-disabled");
  });

  it("does NOT flag an optimized release build", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle",
      `android { buildTypes { release { minifyEnabled true\nshrinkResources true } } }`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-android-release-shrinking-disabled");
  });

  it("does NOT flag dynamic release settings", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle",
      `android { buildTypes { release { minifyEnabled enableProguardInReleaseBuilds\nshrinkResources shouldShrink } } }`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-android-release-shrinking-disabled");
  });

  it("does NOT treat a compound expression beginning with false as statically disabled", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle.kts",
      `android { buildTypes { release { isMinifyEnabled = false || shouldMinify } } }`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-android-release-shrinking-disabled");
  });

  it("does NOT flag comments or debug-only settings", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle",
      `android { buildTypes { debug { minifyEnabled false } release { // minifyEnabled false\nminifyEnabled true\n/* shrinkResources false */\nshrinkResources true } } }`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-android-release-shrinking-disabled");
  });

  it("does NOT flag Gradle string contents", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle",
      `android { buildTypes { release { println("minifyEnabled false")\nminifyEnabled true } } }`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-android-release-shrinking-disabled");
  });

  it("does NOT parse a release block written inside a Gradle string", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle",
      `println("buildTypes { release { minifyEnabled false } }")`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-android-release-shrinking-disabled");
  });

  it("uses the final literal assignment in the release block", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle.kts",
      `android { buildTypes { release { isMinifyEnabled = false\nisMinifyEnabled = true } } }`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-android-release-shrinking-disabled");
  });

  it("does NOT infer precedence across multiple release configuration blocks", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "rn-app",
      dependencies: { "react-native": "0.82.0" },
    });
    writeFile(
      projectDirectory,
      "android/app/build.gradle.kts",
      `android { buildTypes { release { isMinifyEnabled = false } getByName("release") { isMinifyEnabled = true } } }`,
    );

    expect(
      rulesOf(checkReactNativeProject(projectDirectory, buildRnProject(projectDirectory))),
    ).not.toContain("rn-android-release-shrinking-disabled");
  });
});
