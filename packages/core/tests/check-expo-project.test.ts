import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { checkExpoProject, clearPackageJsonCache } from "@react-doctor/core";
import type { Diagnostic, PackageJson, ProjectInfo } from "@react-doctor/core";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-expo-checks-"));

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
  // Each scenario writes a fresh package.json; bust the read cache so the
  // checks observe this fixture rather than a same-path predecessor.
  clearPackageJsonCache();
};

const buildExpoProject = (
  rootDirectory: string,
  expoVersion: string | null = "~51.0.0",
): ProjectInfo => ({
  rootDirectory,
  projectName: "expo-app",
  reactVersion: "18.2.0",
  reactMajorVersion: 18,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "expo",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: true,
  expoVersion,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 10,
});

const writeAppJson = (projectDirectory: string, expoConfig: Record<string, unknown>): void => {
  fs.writeFileSync(
    path.join(projectDirectory, "app.json"),
    JSON.stringify({ expo: expoConfig }, null, 2),
  );
};

const writeFile = (projectDirectory: string, fileName: string, contents: string): void => {
  fs.writeFileSync(path.join(projectDirectory, fileName), contents);
};

const rulesOf = (diagnostics: ReadonlyArray<Diagnostic>): string[] =>
  diagnostics.map((diagnostic) => diagnostic.rule);

const initGitRepo = (projectDirectory: string): void => {
  execFileSync("git", ["init", "-q"], { cwd: projectDirectory });
};

describe("checkExpoProject — gating", () => {
  it("emits nothing when the project is not an Expo project", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "web-app",
      dependencies: { "react-native-unimodules": "^0.14.0", expo: "~51.0.0" },
    });
    const diagnostics = checkExpoProject(
      projectDirectory,
      buildExpoProject(projectDirectory, null),
    );
    expect(diagnostics).toEqual([]);
  });
});

describe("checkExpoProject — illegal unimodules packages", () => {
  it("flags each legacy unimodules package", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: {
        expo: "~51.0.0",
        "@unimodules/core": "^7.0.0",
        "react-native-unimodules": "^0.14.0",
      },
    });
    const diagnostics = checkExpoProject(projectDirectory, buildExpoProject(projectDirectory));
    const unimodulesHits = diagnostics.filter((d) => d.rule === "expo-no-unimodules-packages");
    expect(unimodulesHits).toHaveLength(2);
  });
});

describe("checkExpoProject — CLI dependencies", () => {
  it("flags expo-cli and eas-cli as project dependencies", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "~51.0.0" },
      devDependencies: { "expo-cli": "^6.0.0", "eas-cli": "^7.0.0" },
    });
    const diagnostics = checkExpoProject(projectDirectory, buildExpoProject(projectDirectory));
    expect(rulesOf(diagnostics).filter((rule) => rule === "expo-no-cli-dependencies")).toHaveLength(
      2,
    );
  });
});

describe("checkExpoProject — redundant transitive dependencies", () => {
  it("flags always-redundant packages regardless of SDK", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: {
        expo: "~51.0.0",
        "expo-modules-core": "~1.0.0",
        "@expo/metro-config": "~0.18.0",
      },
    });
    const diagnostics = checkExpoProject(projectDirectory, buildExpoProject(projectDirectory));
    expect(
      rulesOf(diagnostics).filter((rule) => rule === "expo-no-redundant-dependency"),
    ).toHaveLength(2);
  });

  it("only flags SDK-gated packages when the resolved SDK is high enough", () => {
    const oldSdk = makeProjectDirectory();
    writePackageJson(oldSdk, {
      name: "expo-app",
      dependencies: { expo: "~47.0.0", "@types/react-native": "^0.70.0" },
    });
    expect(
      rulesOf(checkExpoProject(oldSdk, buildExpoProject(oldSdk, "~47.0.0"))).filter(
        (rule) => rule === "expo-no-redundant-dependency",
      ),
    ).toHaveLength(0);

    const newSdk = makeProjectDirectory();
    writePackageJson(newSdk, {
      name: "expo-app",
      dependencies: { expo: "~51.0.0", "@types/react-native": "^0.70.0" },
    });
    expect(
      rulesOf(checkExpoProject(newSdk, buildExpoProject(newSdk, "~51.0.0"))).filter(
        (rule) => rule === "expo-no-redundant-dependency",
      ),
    ).toHaveLength(1);
  });
});

describe("checkExpoProject — dependency overrides", () => {
  it("flags overrides on SDK-critical packages across npm/yarn/pnpm fields", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "~51.0.0" },
      overrides: { metro: "0.80.0" },
      resolutions: { "@expo/cli": "0.18.0" },
      pnpm: { overrides: { "metro-resolver": "0.80.0" } },
    });
    const diagnostics = checkExpoProject(projectDirectory, buildExpoProject(projectDirectory));
    const overrideHits = diagnostics.filter(
      (d) => d.rule === "expo-no-conflicting-dependency-override",
    );
    expect(overrideHits).toHaveLength(1);
    expect(overrideHits[0]?.message).toContain('"@expo/cli"');
    expect(overrideHits[0]?.message).toContain('"metro"');
    expect(overrideHits[0]?.message).toContain('"metro-resolver"');
  });

  it("ignores overrides on unrelated packages", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "~51.0.0" },
      overrides: { lodash: "4.17.21" },
    });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).not.toContain("expo-no-conflicting-dependency-override");
  });
});

describe("checkExpoProject — expo-router / react-navigation conflict", () => {
  it("flags @react-navigation packages alongside expo-router on SDK 56+", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: {
        expo: "~56.0.0",
        "expo-router": "~4.0.0",
        "@react-navigation/native": "^7.0.0",
      },
    });
    const diagnostics = checkExpoProject(
      projectDirectory,
      buildExpoProject(projectDirectory, "~56.0.0"),
    );
    expect(rulesOf(diagnostics)).toContain("expo-router-no-react-navigation");
  });

  it("stays quiet on SDK 55 where the pairing is supported", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: {
        expo: "~55.0.0",
        "expo-router": "~3.5.0",
        "@react-navigation/native": "^6.0.0",
      },
    });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~55.0.0"))),
    ).not.toContain("expo-router-no-react-navigation");
  });

  it("stays quiet on SDK 57+ where expo-doctor's `<57.0.0` range no longer applies", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: {
        expo: "~57.0.0",
        "expo-router": "~5.0.0",
        "@react-navigation/native": "^7.0.0",
      },
    });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~57.0.0"))),
    ).not.toContain("expo-router-no-react-navigation");
  });
});

describe("checkExpoProject — vector icons conflict", () => {
  it("flags scoped + legacy icon packages together on SDK 56+", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: {
        expo: "~56.0.0",
        "@react-native-vector-icons/common": "^12.0.0",
        "@expo/vector-icons": "^14.0.0",
      },
    });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~56.0.0"))),
    ).toContain("expo-vector-icons-conflict");
  });

  it("flags any scoped `@react-native-vector-icons/*` package, not just `common`", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: {
        expo: "~56.0.0",
        "@react-native-vector-icons/material-design-icons": "^12.0.0",
        "@expo/vector-icons": "^14.0.0",
      },
    });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~56.0.0"))),
    ).toContain("expo-vector-icons-conflict");
  });
});

describe("checkExpoProject — package.json conflicts", () => {
  it("flags an `expo` script and a name that collides with a dependency", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-router",
      scripts: { expo: "expo start" },
      dependencies: { expo: "~51.0.0", "expo-router": "~3.5.0" },
    });
    const diagnostics = checkExpoProject(projectDirectory, buildExpoProject(projectDirectory));
    expect(
      rulesOf(diagnostics).filter((rule) => rule === "expo-package-json-conflict"),
    ).toHaveLength(2);
  });
});

describe("checkExpoProject — lockfile", () => {
  it("flags a missing lock file", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).toContain("expo-lockfile");
  });

  it("flags multiple lock files", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    fs.writeFileSync(path.join(projectDirectory, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(projectDirectory, "yarn.lock"), "");
    const lockfileHits = checkExpoProject(
      projectDirectory,
      buildExpoProject(projectDirectory),
    ).filter((d) => d.rule === "expo-lockfile");
    expect(lockfileHits).toHaveLength(1);
    expect(lockfileHits[0]?.message).toContain("Multiple lock files");
  });

  it("stays quiet with exactly one lock file", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    fs.writeFileSync(path.join(projectDirectory, "package-lock.json"), "{}");
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).not.toContain("expo-lockfile");
  });

  it("uses the scanned directory's own lock file when it is itself a workspace root", () => {
    // Outer workspace root, intentionally WITHOUT a lock file. `findMonorepoRoot`
    // (parents-only) would climb to this and falsely report a missing lock file.
    const outerRoot = makeProjectDirectory();
    fs.writeFileSync(path.join(outerRoot, "pnpm-workspace.yaml"), "packages:\n  - inner\n");
    // The scanned project is a nested workspace root that ships its own lock file.
    const innerRoot = path.join(outerRoot, "inner");
    fs.mkdirSync(innerRoot, { recursive: true });
    writePackageJson(innerRoot, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    fs.writeFileSync(path.join(innerRoot, "pnpm-workspace.yaml"), "packages:\n  - .\n");
    fs.writeFileSync(path.join(innerRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    expect(rulesOf(checkExpoProject(innerRoot, buildExpoProject(innerRoot)))).not.toContain(
      "expo-lockfile",
    );
  });
});

describe("checkExpoProject — metro config", () => {
  it("flags a metro.config.js that does not extend expo/metro-config", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "metro.config.js"),
      "module.exports = { resolver: {} };\n",
    );
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).toContain("expo-metro-config");
  });

  it("stays quiet when metro.config.js extends expo/metro-config", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "metro.config.js"),
      "const { getDefaultConfig } = require('expo/metro-config');\nmodule.exports = getDefaultConfig(__dirname);\n",
    );
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).not.toContain("expo-metro-config");
  });

  it("stays quiet when metro.config.js extends expo via Sentry's getSentryExpoConfig wrapper", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~56.0.0" } });
    fs.writeFileSync(
      path.join(projectDirectory, "metro.config.js"),
      'const { getSentryExpoConfig } = require("@sentry/react-native/metro");\nconst config = getSentryExpoConfig(__dirname);\nmodule.exports = config;\n',
    );
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).not.toContain("expo-metro-config");
  });
});

describe("checkExpoProject — env local files (git)", () => {
  it("flags a committed .env.local that is not gitignored", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    initGitRepo(projectDirectory);
    fs.writeFileSync(path.join(projectDirectory, ".env.local"), "SECRET=1\n");
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).toContain("expo-env-local-not-gitignored");
  });

  it("stays quiet when .env.local is gitignored", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    initGitRepo(projectDirectory);
    fs.writeFileSync(path.join(projectDirectory, ".gitignore"), ".env*.local\n");
    fs.writeFileSync(path.join(projectDirectory, ".env.local"), "SECRET=1\n");
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).not.toContain("expo-env-local-not-gitignored");
  });
});

describe("checkExpoProject — gitignore (.expo / local modules)", () => {
  it("flags a committed .expo directory", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    initGitRepo(projectDirectory);
    fs.mkdirSync(path.join(projectDirectory, ".expo"), { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, ".expo", "devices.json"), "{}");
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).toContain("expo-gitignore");
  });

  it("flags a local module's native dirs that are gitignored", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~51.0.0" } });
    initGitRepo(projectDirectory);
    // Broad ignore rules that swallow the module's native directories.
    fs.writeFileSync(path.join(projectDirectory, ".gitignore"), ".expo/\nandroid\nios\n");
    const moduleAndroid = path.join(projectDirectory, "modules", "my-mod", "android");
    fs.mkdirSync(moduleAndroid, { recursive: true });
    fs.writeFileSync(path.join(moduleAndroid, "build.gradle"), "// gradle\n");
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory))),
    ).toContain("expo-gitignore");
  });
});

describe("checkExpoProject — reanimated v4 requires new architecture", () => {
  it("flags reanimated v4 with newArchEnabled: false as an error", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "~52.0.0", "react-native-reanimated": "~4.0.0" },
    });
    writeAppJson(projectDirectory, { name: "x", newArchEnabled: false });
    const diagnostics = checkExpoProject(
      projectDirectory,
      buildExpoProject(projectDirectory, "~52.0.0"),
    );
    const hit = diagnostics.find((d) => d.rule === "expo-reanimated-v4-requires-new-arch");
    expect(hit).toBeDefined();
    // A guaranteed first-launch crash must surface by default (errors aren't hidden).
    expect(hit?.severity).toBe("error");
  });

  it("flags when react-native-worklets is present with newArchEnabled: false", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "~52.0.0", "react-native-worklets": "^0.1.0" },
    });
    writeAppJson(projectDirectory, { name: "x", newArchEnabled: false });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~52.0.0"))),
    ).toContain("expo-reanimated-v4-requires-new-arch");
  });

  it("does NOT flag reanimated v3 with newArchEnabled: false", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "~52.0.0", "react-native-reanimated": "~3.10.0" },
    });
    writeAppJson(projectDirectory, { name: "x", newArchEnabled: false });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~52.0.0"))),
    ).not.toContain("expo-reanimated-v4-requires-new-arch");
  });

  it("does NOT flag reanimated v4 when newArchEnabled is not disabled", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "~52.0.0", "react-native-reanimated": "~4.0.0" },
    });
    writeAppJson(projectDirectory, { name: "x" });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~52.0.0"))),
    ).not.toContain("expo-reanimated-v4-requires-new-arch");
  });

  // Regression (Bugbot): a dynamic app.config.{js,ts} can override app.json, so
  // a stale `newArchEnabled: false` in app.json must NOT trip the check when a
  // dynamic config is present (we can't evaluate it offline).
  it("does NOT flag when a dynamic app.config.js may override a stale app.json", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, {
      name: "expo-app",
      dependencies: { expo: "~52.0.0", "react-native-reanimated": "~4.0.0" },
    });
    writeAppJson(projectDirectory, { name: "x", newArchEnabled: false });
    writeFile(
      projectDirectory,
      "app.config.js",
      "module.exports = ({ config }) => ({ ...config, newArchEnabled: true });\n",
    );
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~52.0.0"))),
    ).not.toContain("expo-reanimated-v4-requires-new-arch");
  });
});

describe("checkExpoProject — unsafe updates production config", () => {
  it("flags updates.disableAntiBrickingMeasures: true as an error", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~52.0.0" } });
    writeAppJson(projectDirectory, {
      name: "x",
      updates: { disableAntiBrickingMeasures: true },
    });
    const diagnostics = checkExpoProject(
      projectDirectory,
      buildExpoProject(projectDirectory, "~52.0.0"),
    );
    const hit = diagnostics.find((d) => d.rule === "expo-updates-no-unsafe-production-config");
    expect(hit).toBeDefined();
    // Can permanently brick installed apps — must surface by default.
    expect(hit?.severity).toBe("error");
  });

  it("does NOT flag when the flag is absent", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~52.0.0" } });
    writeAppJson(projectDirectory, { name: "x", updates: { fallbackToCacheTimeout: 0 } });
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~52.0.0"))),
    ).not.toContain("expo-updates-no-unsafe-production-config");
  });

  // Regression (Bugbot): a dynamic config may override a stale app.json value.
  it("does NOT flag disableAntiBrickingMeasures from app.json when a dynamic config exists", () => {
    const projectDirectory = makeProjectDirectory();
    writePackageJson(projectDirectory, { name: "expo-app", dependencies: { expo: "~52.0.0" } });
    writeAppJson(projectDirectory, {
      name: "x",
      updates: { disableAntiBrickingMeasures: true },
    });
    writeFile(projectDirectory, "app.config.ts", "export default ({ config }) => config;\n");
    expect(
      rulesOf(checkExpoProject(projectDirectory, buildExpoProject(projectDirectory, "~52.0.0"))),
    ).not.toContain("expo-updates-no-unsafe-production-config");
  });
});
