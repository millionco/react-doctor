/**
 * Regression tests for the package- and branch-aware scoping of the
 * React Native rule bucket.
 *
 * Background: every `rn-*` rule used to fire purely off the project-level
 * `framework: "react-native"` capability gate. In a mixed monorepo where
 * the root project is detected as React Native (because one workspace
 * declares `react-native`) the rules would also fire on every web-only
 * sibling workspace — Next, Vite, Docusaurus, Storybook, plain React
 * DOM packages — which is wrong. `rn-no-raw-text` shipped a narrow
 * file-extension escape hatch (`.web.[jt]sx?`) and a "use dom" directive
 * check, but no understanding of package boundaries, framework hints,
 * or `Platform.OS === "web"` branches.
 *
 * The tests below pin the new behavior:
 *   - React Native rules skip files whose nearest `package.json`
 *     declares a web-only framework (Next, Vite, CRA, Remix, Gatsby,
 *     Docusaurus, Storybook, plain react-dom).
 *   - React Native rules continue to fire when the nearest package
 *     declares `react-native` or `expo` (even inside a mixed monorepo).
 *   - `.web.tsx` / `.web.jsx` files are skipped regardless of package.
 *   - `.ios.tsx` / `.android.tsx` / `.native.tsx` files are scanned
 *     regardless of package (force-on for the RN target).
 *   - `rn-no-raw-text` skips raw text inside `Platform.OS === "web"`
 *     branches (if-statement consequent, conditional-expression
 *     consequent, logical-and short-circuit, and the mirror
 *     `Platform.OS !== "web"` alternate branch).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import { discoverProject } from "@react-doctor/project-info";
import type { Diagnostic, PackageJson } from "@react-doctor/types";
import { buildTestProject, setupReactProject, writeFile, writeJson } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-rn-scope-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "..", "fixtures");
const MIXED_MONOREPO_FIXTURE = path.join(FIXTURES_DIRECTORY, "mixed-rn-web-monorepo");

const findRnDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.rule.startsWith("rn-"));

const findDiagnosticsByRule = (diagnostics: Diagnostic[], rule: string): Diagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.rule === rule);

const findDiagnosticsByFile = (diagnostics: Diagnostic[], relativePath: string): Diagnostic[] =>
  diagnostics.filter((diagnostic) =>
    diagnostic.filePath.replaceAll("\\", "/").endsWith(relativePath),
  );

describe("mixed RN + web monorepo: rn-* rules respect package boundaries", () => {
  let allDiagnostics: Diagnostic[] = [];

  beforeAll(async () => {
    allDiagnostics = await runOxlint({
      rootDirectory: MIXED_MONOREPO_FIXTURE,
      project: buildTestProject({
        rootDirectory: MIXED_MONOREPO_FIXTURE,
        framework: "react-native",
      }),
    });
  });

  it("fires rn-no-raw-text inside the React Native (Expo) workspace", () => {
    const mobileRnRawText = findDiagnosticsByFile(
      findDiagnosticsByRule(allDiagnostics, "rn-no-raw-text"),
      "apps/mobile/src/Screen.tsx",
    );
    expect(mobileRnRawText.length).toBeGreaterThan(0);
  });

  it("does not fire rn-no-raw-text inside the Next.js workspace", () => {
    const webDiagnostics = findDiagnosticsByFile(
      findRnDiagnostics(allDiagnostics),
      "apps/web/src/Page.tsx",
    );
    expect(webDiagnostics).toHaveLength(0);
  });

  it("does not fire rn-no-raw-text inside the Vite workspace", () => {
    const viteDiagnostics = findDiagnosticsByFile(
      findRnDiagnostics(allDiagnostics),
      "apps/vite-app/src/Vite.tsx",
    );
    expect(viteDiagnostics).toHaveLength(0);
  });

  it("does not fire rn-no-raw-text inside the Docusaurus workspace", () => {
    const docsDiagnostics = findDiagnosticsByFile(
      findRnDiagnostics(allDiagnostics),
      "apps/docs/src/Doc.tsx",
    );
    expect(docsDiagnostics).toHaveLength(0);
  });

  it("does not fire rn-no-raw-text inside the Storybook workspace", () => {
    const storybookDiagnostics = findDiagnosticsByFile(
      findRnDiagnostics(allDiagnostics),
      "packages/storybook/src/Button.stories.tsx",
    );
    expect(storybookDiagnostics).toHaveLength(0);
  });

  it("falls back to the project-level framework hint on shared packages that declare neither RN nor a web framework (rule stays ACTIVE)", () => {
    // The shared package has only `react` listed — neither
    // `react-native`/`expo` nor a web framework. Without a clear local
    // signal we fall back to the project-level framework setting (here
    // forced to "react-native" by buildTestProject), so the rule should
    // remain active. This pins the conservative fallback behavior.
    const sharedDiagnostics = findDiagnosticsByFile(
      findDiagnosticsByRule(allDiagnostics, "rn-no-raw-text"),
      "packages/shared/src/Shared.tsx",
    );
    expect(sharedDiagnostics.length).toBeGreaterThan(0);
  });
});

describe("rn-no-raw-text: framework-only project boundaries (single-package fixtures)", () => {
  it("does not fire on a Next.js-only project even when the project framework is forced to react-native (file-level guard)", async () => {
    const projectDir = setupReactProject(tempRoot, "single-next-project", {
      packageJsonExtras: {
        dependencies: {
          next: "^14.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      files: {
        "src/Page.tsx": `export const Page = () => <View>Hello next</View>;\n`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("does not fire on a Vite-only project", async () => {
    const projectDir = setupReactProject(tempRoot, "single-vite-project", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        devDependencies: { vite: "^5.0.0" },
      },
      files: {
        "src/App.tsx": `export const App = () => <View>Vite-only</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("does not fire on a Docusaurus-only project", async () => {
    const projectDir = setupReactProject(tempRoot, "single-docusaurus-project", {
      packageJsonExtras: {
        dependencies: {
          "@docusaurus/core": "^3.4.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      files: {
        "src/App.tsx": `export const App = () => <View>Docs landing</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("does not fire on a Storybook-only project", async () => {
    const projectDir = setupReactProject(tempRoot, "single-storybook-project", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        devDependencies: {
          storybook: "^8.0.0",
          "@storybook/react": "^8.0.0",
        },
      },
      files: {
        "src/Button.stories.tsx": `export const Story = () => <View>Storybook label</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("does not fire on a plain React-DOM-only project (no framework)", async () => {
    const projectDir = setupReactProject(tempRoot, "single-react-dom-project", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files: {
        "src/App.tsx": `export const App = () => <View>DOM-only</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("still fires on a single-package React Native project (with `react-native` in dependencies)", async () => {
    const projectDir = setupReactProject(tempRoot, "single-rn-project", {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: {
        "src/Screen.tsx": `import { View } from "react-native";\nexport const Screen = () => <View>Hello RN</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("still fires on a single-package Expo project (with `expo` in dependencies)", async () => {
    const projectDir = setupReactProject(tempRoot, "single-expo-project", {
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          expo: "^51.0.0",
          "expo-router": "^3.5.0",
        },
      },
      files: {
        "src/Screen.tsx": `import { View } from "react-native";\nexport const Screen = () => <View>Hello Expo</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });
});

describe("rn-no-raw-text: platform-aware file extensions", () => {
  const setupRnProjectWithFiles = (caseId: string, files: Record<string, string>): string =>
    setupReactProject(tempRoot, caseId, {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files,
    });

  it("skips `.web.tsx` files inside a React Native package", async () => {
    const projectDir = setupRnProjectWithFiles("rn-web-extension", {
      "src/Screen.web.tsx": `export const Screen = () => <View>Hello web</View>;\n`,
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("still fires on `.ios.tsx` files (native-only extension)", async () => {
    const projectDir = setupRnProjectWithFiles("rn-ios-extension", {
      "src/Screen.ios.tsx": `export const Screen = () => <View>Hello iOS</View>;\n`,
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("still fires on `.android.tsx` files (native-only extension)", async () => {
    const projectDir = setupRnProjectWithFiles("rn-android-extension", {
      "src/Screen.android.tsx": `export const Screen = () => <View>Hello Android</View>;\n`,
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("still fires on `.native.tsx` files (native-only extension)", async () => {
    const projectDir = setupRnProjectWithFiles("rn-native-extension", {
      "src/Screen.native.tsx": `export const Screen = () => <View>Hello native</View>;\n`,
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("still respects the `use dom` directive (Expo Router DOM components opt-out)", async () => {
    const projectDir = setupRnProjectWithFiles("rn-use-dom-directive", {
      "src/DomComponent.tsx": `"use dom";\nexport const DomComponent = () => <div>Web rendered</div>;\n`,
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });
});

describe("rn-no-raw-text: Platform.OS branch handling", () => {
  const setupPlatformOsProject = (caseId: string, sourceCode: string): string =>
    setupReactProject(tempRoot, caseId, {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: { "src/Screen.tsx": sourceCode },
    });

  it("skips raw text inside `if (Platform.OS === 'web') { … }` consequent branches", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-if-consequent",
      `import { Platform, View } from "react-native";

export const Screen = () => {
  if (Platform.OS === "web") {
    return <View>Web fallback markup</View>;
  }
  return null;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("skips raw text inside `Platform.OS === 'web' ? <X /> : <Y />` consequent (conditional expression)", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-ternary",
      `import { Platform, Text, View } from "react-native";

export const Screen = () =>
  Platform.OS === "web" ? <View>Web text</View> : <Text>Native text</Text>;
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("skips raw text inside `Platform.OS === 'web' && <X />` logical-and short-circuit", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-logical-and",
      `import { Platform, View } from "react-native";

export const Screen = () => (
  <>
    {Platform.OS === "web" && <View>Web only</View>}
  </>
);
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("skips raw text inside the `else` branch of `if (Platform.OS !== 'web')` (mirror form)", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-not-equals",
      `import { Platform, Text, View } from "react-native";

export const Screen = () => {
  if (Platform.OS !== "web") {
    return <Text>Native</Text>;
  } else {
    return <View>Web fallback</View>;
  }
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("STILL fires raw text inside a `Platform.OS === 'ios'` consequent (only the web branch is exempt)", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-ios-still-fires",
      `import { Platform, View } from "react-native";

export const Screen = () => {
  if (Platform.OS === "ios") {
    return <View>iOS-only raw text</View>;
  }
  return null;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("STILL fires raw text in the `if (Platform.OS === 'web')` alternate (else) branch", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-else-still-fires",
      `import { Platform, View } from "react-native";

export const Screen = () => {
  if (Platform.OS === "web") {
    return null;
  } else {
    return <View>Native fallback that would crash</View>;
  }
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("STILL fires raw text in OTHER siblings of the conditional, outside the web branch", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-sibling-still-fires",
      `import { Platform, View } from "react-native";

export const Screen = () => (
  <View>
    Top-level raw text that must crash on native
    {Platform.OS === "web" && <View>Web branch raw text — ok</View>}
  </View>
);
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    const rnRawText = findDiagnosticsByRule(diagnostics, "rn-no-raw-text");
    expect(rnRawText.length).toBeGreaterThan(0);
    // The siblings outside the branch should be the only ones reported —
    // assert the branch-internal "Web branch raw text — ok" is NOT in
    // the diagnostics output by checking the message of every hit.
    for (const diagnostic of rnRawText) {
      expect(diagnostic.message).not.toContain("Web branch raw text");
    }
  });
});

describe("Platform.OS branch detection: `'web' === Platform.OS` and `'web' !== Platform.OS` (reversed operand order)", () => {
  it("recognizes `'web' === Platform.OS` as a web branch", async () => {
    const projectDir = setupReactProject(tempRoot, "platform-os-reversed-eq", {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: {
        "src/Screen.tsx": `import { Platform, View } from "react-native";
export const Screen = () => {
  if ("web" === Platform.OS) {
    return <View>Web fallback</View>;
  }
  return null;
};
`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });
});

describe("React Native rules in nested files (file-level package detection)", () => {
  it("does not fire rn-no-raw-text on a nested file inside a web-only sub-package even when the OUTER directory has react-native", async () => {
    // Top-level project declares `react-native`, but a nested sub-package
    // (`packages/web-ui/package.json` declaring `next`) is a web-only
    // boundary. The wrapper walks UP to the nearest package.json — the
    // nested one wins.
    const projectDir = setupReactProject(tempRoot, "rn-with-web-subpackage", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        "src/App.tsx": `import { View } from "react-native";\nexport const App = () => <View>RN root</View>;\n`,
      },
    });
    writeJson(path.join(projectDir, "packages", "web-ui", "package.json"), {
      name: "web-ui",
      dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    });
    writeFile(
      path.join(projectDir, "packages", "web-ui", "src", "Web.tsx"),
      `export const Web = () => <View>Web subpackage</View>;\n`,
    );

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });

    const rnHits = findDiagnosticsByRule(diagnostics, "rn-no-raw-text");
    const normalizedHits = rnHits.map((diagnostic) => diagnostic.filePath.replaceAll("\\", "/"));
    const innerHits = normalizedHits.filter((filePath) => filePath.includes("packages/web-ui/"));
    const outerHits = normalizedHits.filter(
      (filePath) => filePath.endsWith("src/App.tsx") && !filePath.includes("packages/"),
    );
    expect(innerHits).toHaveLength(0);
    expect(outerHits.length).toBeGreaterThan(0);
  });
});

describe("rn-no-raw-text: Platform.OS via switch statement", () => {
  const setupPlatformOsProject = (caseId: string, sourceCode: string): string =>
    setupReactProject(tempRoot, caseId, {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: { "src/Screen.tsx": sourceCode },
    });

  it("skips raw text inside `switch (Platform.OS) { case 'web': … }`", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-switch-case-web",
      `import { Platform, Text, View } from "react-native";

export const Screen = () => {
  switch (Platform.OS) {
    case "web":
      return <View>Web fallback markup</View>;
    case "ios":
      return <Text>iOS</Text>;
    default:
      return null;
  }
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("STILL fires inside `switch (Platform.OS) { case 'ios': <raw View/> }` (only the web case is exempt)", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-switch-case-ios-still-fires",
      `import { Platform, View } from "react-native";

export const Screen = () => {
  switch (Platform.OS) {
    case "web":
      return null;
    case "ios":
      return <View>iOS raw text that would crash</View>;
    default:
      return null;
  }
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("does NOT treat `switch (someOtherDiscriminant) { case 'web': … }` as a Platform.OS branch", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-switch-wrong-discriminant",
      `import { View } from "react-native";

declare const target: string;

export const Screen = () => {
  switch (target) {
    case "web":
      return <View>Wrong discriminant — still RN territory</View>;
    default:
      return null;
  }
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });
});

describe("rn-no-raw-text: nested branches and other Platform.OS shapes", () => {
  const setupPlatformOsProject = (caseId: string, sourceCode: string): string =>
    setupReactProject(tempRoot, caseId, {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: { "src/Screen.tsx": sourceCode },
    });

  it("skips raw text inside an intermediate guard nested in the web branch", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-nested-guard",
      `import { Platform, View } from "react-native";

declare const someFlag: boolean;

export const Screen = () => {
  if (Platform.OS === "web") {
    if (someFlag) {
      return <View>Web branch, gated by an inner flag</View>;
    }
  }
  return null;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("skips raw text inside an `else if (Platform.OS === 'web')` arm of an else-if chain", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-else-if-chain",
      `import { Platform, Text, View } from "react-native";

declare const someFlag: boolean;

export const Screen = () => {
  if (someFlag) {
    return <Text>flag</Text>;
  } else if (Platform.OS === "web") {
    return <View>Web fallback</View>;
  }
  return null;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("STILL fires inside a compound `if (Platform.OS === 'web' && someFlag)` consequent — compound tests are NOT exempt (conservative)", async () => {
    // Rationale: a `LogicalExpression` test could pivot on either
    // operand at runtime, and the walker only inspects the immediate
    // `BinaryExpression`. We deliberately err on the side of FIRING
    // here so the file with a compound web guard is still scanned —
    // users wanting to opt out can split the condition.
    const projectDir = setupPlatformOsProject(
      "platform-os-compound-test",
      `import { Platform, View } from "react-native";

declare const someFlag: boolean;

export const Screen = () => {
  if (Platform.OS === "web" && someFlag) {
    return <View>Compound condition raw text</View>;
  }
  return null;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("STILL fires raw text rendered after an early `if (Platform.OS !== 'web') return null;` (early-return is NOT exempt, pinned as a known limitation)", async () => {
    // Pin the negative case: even though control-flow analysis WOULD
    // mark every JSX node after the early return as web-only, the
    // ancestor-walker doesn't model returns. Documenting the
    // limitation in a test keeps the rationale visible.
    const projectDir = setupPlatformOsProject(
      "platform-os-early-return",
      `import { Platform, View } from "react-native";

export const Screen = () => {
  if (Platform.OS !== "web") return null;
  return <View>After the early return — still flagged</View>;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("does NOT treat negated equality (`!(Platform.OS === 'web')`) as a web branch", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-negated",
      `import { Platform, View } from "react-native";

export const Screen = () => {
  if (!(Platform.OS === "web")) {
    return <View>Negated equality consequent — NOT the web branch</View>;
  }
  return null;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("does NOT treat a non-strict equality check (`Platform.OS == 'web'`) as a web branch (strict-equality only)", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-loose-equality",
      `import { Platform, View } from "react-native";

export const Screen = () => {
  // eslint-disable-next-line eqeqeq
  if (Platform.OS == "web") {
    return <View>Loose equality — not exempt</View>;
  }
  return null;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("does NOT treat computed-member access (`Platform['OS'] === 'web'`) as a web branch (conservative)", async () => {
    const projectDir = setupPlatformOsProject(
      "platform-os-computed-access",
      `import { Platform, View } from "react-native";

export const Screen = () => {
  if (Platform["OS"] === "web") {
    return <View>Computed access — not matched</View>;
  }
  return null;
};
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });
});

describe("classify-package-platform: dependency-section coverage", () => {
  it("classifies a package with `react-native` only in `peerDependencies` as react-native", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-peer-only", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0" },
        peerDependencies: { "react-native": ">=0.74.0" },
      },
      files: {
        "src/Screen.tsx": `import { View } from "react-native";\nexport const Screen = () => <View>raw</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("classifies a package with `react-native` only in `devDependencies` as react-native", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-dev-only", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0" },
        devDependencies: { "react-native": "0.76.0" },
      },
      files: {
        "src/Screen.tsx": `import { View } from "react-native";\nexport const Screen = () => <View>raw</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("classifies a package with `react-native` only in `optionalDependencies` as react-native", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-optional-only", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0" },
        optionalDependencies: { "react-native": "0.76.0" },
      },
      files: {
        "src/Screen.tsx": `import { View } from "react-native";\nexport const Screen = () => <View>raw</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("classifies a package with `expo-router` only as react-native (Expo Router implies an Expo/RN target)", async () => {
    const projectDir = setupReactProject(tempRoot, "expo-router-only", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "expo-router": "^3.5.0" },
      },
      files: {
        "src/Screen.tsx": `export const Screen = () => <View>raw</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("treats a manifest with BOTH `react-native` AND `next` as react-native (RN priority — react-native-web shape)", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-and-next-mixed", {
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          "react-native": "0.76.0",
          next: "^14.0.0",
          "react-dom": "^19.0.0",
        },
      },
      files: {
        "src/Screen.tsx": `import { View } from "react-native";\nexport const Screen = () => <View>raw on RN</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    // RN wins over Next when both are declared — the package targets
    // mobile too, so rules must keep firing.
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });
});

describe("classify-package-platform: malformed and empty manifest fallbacks", () => {
  it("treats a malformed package.json as 'unknown' and falls back to the project-level framework hint (active)", async () => {
    const projectDir = path.join(tempRoot, "malformed-pkg");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "package.json"), "{ not valid json,,,");
    writeFile(
      path.join(projectDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { jsx: "preserve", target: "es2022", module: "esnext" },
      }),
    );
    writeFile(
      path.join(projectDir, "src", "Screen.tsx"),
      `export const Screen = () => <View>raw</View>;\n`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("treats an empty `{}` package.json as 'unknown' and falls back to the project-level framework", async () => {
    const projectDir = path.join(tempRoot, "empty-pkg");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {});
    writeJson(path.join(projectDir, "tsconfig.json"), {
      compilerOptions: { jsx: "preserve", target: "es2022", module: "esnext" },
    });
    writeFile(
      path.join(projectDir, "src", "Screen.tsx"),
      `export const Screen = () => <View>raw</View>;\n`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("with the project framework set to 'nextjs' and a malformed sub-package.json, RN rules stay inactive (capability gate never enables them)", async () => {
    const projectDir = path.join(tempRoot, "framework-next-malformed-pkg");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "package.json"), "{ bad");
    writeJson(path.join(projectDir, "tsconfig.json"), {
      compilerOptions: { jsx: "preserve", target: "es2022", module: "esnext" },
    });
    writeFile(
      path.join(projectDir, "src", "Page.tsx"),
      `export const Page = () => <View>raw</View>;\n`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "nextjs" }),
    });
    // The project-level capability gate (`requires: ["react-native"]`)
    // prevents the rule from even loading when the project framework
    // is `nextjs`. Pin that this remains true regardless of file-level
    // ambiguity.
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });
});

describe("classify-package-platform: file-extension overrides win over package classification", () => {
  it("`.web.tsx` is skipped even when the enclosing package declares `react-native`", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-pkg-with-web-extension", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        "src/Screen.web.tsx": `export const Screen = () => <View>web</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("`.ios.tsx` is scanned even when the enclosing package declares a web framework (force-on for native targets)", async () => {
    const projectDir = setupReactProject(tempRoot, "web-pkg-with-ios-extension", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", next: "^14.0.0" },
      },
      files: {
        "src/Screen.ios.tsx": `export const Screen = () => <View>iOS</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("`.web.jsx` is skipped (matches the same `.web.[cm]?[jt]sx?` pattern as `.web.tsx`)", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-pkg-web-jsx-extension", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        "src/Screen.web.jsx": `export const Screen = () => <View>jsx web</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("`.web.tsx.bak` or other suffixed names do NOT trigger the web-extension skip (regex anchored to end-of-name)", async () => {
    // The .bak suffix means oxlint won't even scan the file (not a
    // source extension), so we instead use a filename that DOES end
    // in .tsx but contains `.web` as a non-trailing segment.
    const projectDir = setupReactProject(tempRoot, "rn-pkg-confusable-name", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        // `Screen.web.theme.tsx` does NOT end with `.web.tsx`, so the
        // web-extension shortcut should NOT trigger — the file should
        // be scanned as a normal RN file.
        "src/Screen.web.theme.tsx": `export const Screen = () => <View>not web-only</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });
});

describe("project-level framework fallback when package classification is ambiguous", () => {
  it("with `framework: 'expo'` at the project level and an ambiguous package, RN rules fire", async () => {
    const projectDir = setupReactProject(tempRoot, "ambiguous-pkg-expo-fallback", {
      packageJsonExtras: {
        // No RN or web framework keys, just plain react.
        dependencies: { react: "^19.0.0" },
      },
      files: {
        "src/Screen.tsx": `export const Screen = () => <View>raw</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "expo" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });
});

describe("classify-package-platform: cache safety across independent packages", () => {
  it("classifies two same-cased package names in distinct directories independently (cache key is the directory path)", async () => {
    const rnDir = setupReactProject(tempRoot, "cache-safety-rn-A", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        "src/Screen.tsx": `export const Screen = () => <View>RN raw</View>;\n`,
      },
    });
    const webDir = setupReactProject(tempRoot, "cache-safety-web-A", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", next: "^14.0.0" },
      },
      files: {
        "src/Screen.tsx": `export const Screen = () => <View>web</View>;\n`,
      },
    });

    const rnDiagnostics = await runOxlint({
      rootDirectory: rnDir,
      project: buildTestProject({ rootDirectory: rnDir, framework: "react-native" }),
    });
    const webDiagnostics = await runOxlint({
      rootDirectory: webDir,
      project: buildTestProject({ rootDirectory: webDir, framework: "react-native" }),
    });

    expect(findDiagnosticsByRule(rnDiagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
    expect(findDiagnosticsByRule(webDiagnostics, "rn-no-raw-text")).toHaveLength(0);
  });
});

describe('rn-no-raw-text: "use dom" directive composition with package gating', () => {
  it("`use dom` short-circuits even inside an RN package", async () => {
    const projectDir = setupReactProject(tempRoot, "use-dom-in-rn-pkg", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        "src/Dom.tsx": `"use dom";\nexport const Dom = () => <div>Web rendered</div>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });
});

describe("rn-* rules other than rn-no-raw-text: package gating", () => {
  it("rn-prefer-pressable is silenced on a Next.js sub-package that legitimately imports from react-native (e.g. via solito/react-native-web)", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-prefer-pressable-on-web", {
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          next: "^14.0.0",
        },
      },
      files: {
        // TouchableOpacity import would normally trip rn-prefer-pressable.
        "src/Web.tsx": `import { TouchableOpacity } from "react-native";\nexport const Web = () => <TouchableOpacity />;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-prefer-pressable")).toHaveLength(0);
  });

  it("rn-no-deprecated-modules fires on an RN package even when sibling web sub-packages exist", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-deprecated-mobile-with-web-sibling", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        "src/index.ts": `import { AsyncStorage } from "react-native";\nvoid AsyncStorage;\n`,
      },
    });
    // Drop a web-only sibling package nearby.
    writeJson(path.join(projectDir, "siblings", "web-sibling", "package.json"), {
      name: "web-sibling",
      dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    });
    writeFile(
      path.join(projectDir, "siblings", "web-sibling", "src", "Web.tsx"),
      `export const Web = () => <View>web</View>;\n`,
    );

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    const deprecatedHits = findDiagnosticsByRule(diagnostics, "rn-no-deprecated-modules");
    expect(deprecatedHits.length).toBeGreaterThan(0);
    // No rn-* diagnostic should be reported against the web sibling.
    const webSiblingRn = diagnostics.filter(
      (diagnostic) =>
        diagnostic.rule.startsWith("rn-") &&
        diagnostic.filePath.replaceAll("\\", "/").includes("siblings/web-sibling/"),
    );
    expect(webSiblingRn).toHaveLength(0);
  });
});

describe("React Native package classification: namespace prefixes and Metro `react-native` field", () => {
  it("classifies a package as RN when it declares a `@react-native-firebase/*` dependency (prefix match)", async () => {
    // `@react-native-firebase/app` lives under the `@react-native-`
    // community namespace. The closed-set check in the previous
    // implementation missed it; the prefix match recognises every
    // member of the namespace without us having to enumerate them.
    const projectDir = setupReactProject(tempRoot, "rn-namespace-prefix-match", {
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          "@react-native-firebase/app": "^21.0.0",
        },
      },
      files: {
        "src/Screen.tsx": `export const Screen = () => <View>RN firebase package</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it("classifies a package as RN when it declares Metro's top-level `react-native` resolution field (library manifest)", async () => {
    // RN-only libraries set the top-level `react-native` field so Metro
    // resolves an RN-specific entry over `main` / `module`. The mere
    // presence of the field is enough to classify the package as
    // RN-aware even when its dep list is otherwise empty.
    const projectDir = setupReactProject(tempRoot, "rn-metro-resolution-field", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0" },
        "react-native": "./dist/native/index.js",
      },
      files: {
        "src/Screen.tsx": `export const Screen = () => <View>Metro field library</View>;\n`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });
});

describe("rn-no-raw-text: Platform.select fork (canonical RN platform-fork helper)", () => {
  const setupPlatformSelectProject = (caseId: string, sourceCode: string): string =>
    setupReactProject(tempRoot, caseId, {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: { "src/Screen.tsx": sourceCode },
    });

  it("skips raw text in the `web` arm of `Platform.select({ web: ..., default: ... })`", async () => {
    const projectDir = setupPlatformSelectProject(
      "platform-select-web-arm",
      `import { Platform, View } from "react-native";

export const Screen = () =>
  Platform.select({
    web: <View>Web fallback markup</View>,
    default: null,
  });
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it("STILL fires raw text in non-web arms of `Platform.select` (`default`, `ios`, `android`)", async () => {
    const projectDir = setupPlatformSelectProject(
      "platform-select-default-arm-still-fires",
      `import { Platform, View } from "react-native";

export const Screen = () =>
  Platform.select({
    web: null,
    default: <View>Native fallback that crashes</View>,
  });
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });

  it('recognises the string-quoted property key form `{ "web": ... }`', async () => {
    const projectDir = setupPlatformSelectProject(
      "platform-select-string-key",
      `import { Platform, View } from "react-native";

export const Screen = () =>
  Platform.select({
    "web": <View>Web</View>,
    default: null,
  });
`,
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });
});

describe("rn-no-raw-text: TS / chain wrapping around the Platform.OS read", () => {
  it('recognises `Platform?.OS === "web"` (optional chain)', async () => {
    const projectDir = setupReactProject(tempRoot, "platform-os-optional-chain", {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: {
        "src/Screen.tsx": `import { Platform, View } from "react-native";

export const Screen = () => {
  if (Platform?.OS === "web") {
    return <View>Optional-chain web</View>;
  }
  return null;
};
`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });

  it('recognises `Platform.OS! === "web"` (TS non-null assertion)', async () => {
    const projectDir = setupReactProject(tempRoot, "platform-os-non-null-assertion", {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: {
        "src/Screen.tsx": `import { Platform, View } from "react-native";

export const Screen = () => {
  if (Platform.OS! === "web") {
    return <View>Non-null asserted web</View>;
  }
  return null;
};
`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text")).toHaveLength(0);
  });
});

describe("rn-no-raw-text: scope-boundary pruning (no nested-helper false negatives)", () => {
  it("STILL fires raw text inside a callback hoisted out of a Platform.OS branch", async () => {
    // `renderInner`'s body sits inside the `Platform.OS === "web"`
    // alternate from the caller's perspective, but the function itself
    // is hoisted to top level — it could be called from anywhere, so
    // its raw text must not inherit the parent branch's exemption. The
    // walker stops at the function boundary.
    const projectDir = setupReactProject(tempRoot, "platform-os-scope-boundary-pruning", {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: {
        "src/Screen.tsx": `import { Platform, View } from "react-native";

const renderInner = () => <View>Hoisted raw text</View>;

export const Screen = () => (Platform.OS === "web" ? renderInner() : null);
`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir, framework: "react-native" }),
    });
    expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
  });
});

describe("inverted monorepo: web-rooted project with an RN workspace still loads rn-* rules", () => {
  it("fires rn-no-raw-text on the mobile workspace even when the entry-point `framework` is web-only", async () => {
    // The entry-point project's framework resolves to `nextjs` here
    // (we pass `framework: "nextjs"` explicitly), but
    // `hasReactNativeWorkspace` is `true` because the discovered
    // workspaces include an Expo app. Without the inverted-gate fix
    // the capability builder dropped every `requires: ["react-native"]`
    // rule before the file-level wrapper ever got to run.
    const projectDir = setupReactProject(tempRoot, "inverted-monorepo-web-rooted", {
      packageJsonExtras: {
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        // pnpm-shaped workspaces field also works; npm/yarn flat list
        // is more portable across the test fixtures.
        workspaces: ["apps/*"],
      },
      files: {
        "apps/web/src/Page.tsx": `export const Page = () => <View>Web entry</View>;\n`,
      },
    });
    writeJson(path.join(projectDir, "apps", "web", "package.json"), {
      name: "web",
      dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    });
    writeJson(path.join(projectDir, "apps", "mobile", "package.json"), {
      name: "mobile",
      dependencies: { react: "^19.0.0", "react-native": "0.76.0", expo: "^51.0.0" },
    });
    writeFile(
      path.join(projectDir, "apps", "mobile", "src", "Screen.tsx"),
      `import { View } from "react-native";\nexport const Screen = () => <View>Mobile entry</View>;\n`,
    );

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: {
        ...buildTestProject({ rootDirectory: projectDir, framework: "nextjs" }),
        hasReactNativeWorkspace: true,
      },
    });

    const rnHits = findDiagnosticsByRule(diagnostics, "rn-no-raw-text");
    const normalizedPaths = rnHits.map((diagnostic) => diagnostic.filePath.replaceAll("\\", "/"));
    expect(normalizedPaths.some((filePath) => filePath.includes("apps/mobile/"))).toBe(true);
    expect(normalizedPaths.some((filePath) => filePath.includes("apps/web/"))).toBe(false);
  });
});

// Each entry encodes a single RN "signal" the two predicates have to
// agree on — added once here, exercised against BOTH layers below.
//
//   project-info side: `discoverProject(...).hasReactNativeWorkspace`
//                      gates whether the `react-native` capability is
//                      added in `buildCapabilities`, deciding if any
//                      `rn-*` rule loads at all.
//
//   oxlint plugin side: `classifyPackagePlatform` (called by every
//                       `rn-*` rule via `wrapReactNativeRule`)
//                       decides whether a given file's nearest
//                       `package.json` is treated as RN-aware.
//
// When someone adds a new package name to one side and forgets the
// other, the sync table below catches the drift on its next test run.
interface ReactNativeSignal {
  description: string;
  // `packageJsonExtras` is splatted into the workspace package.json.
  // Use `dependencies` / `devDependencies` / `peerDependencies` /
  // `optionalDependencies` / `"react-native"` to pin the RN signal
  // shape under test.
  packageJsonExtras: Partial<PackageJson> & { "react-native"?: string };
}

const REACT_NATIVE_SIGNALS: ReadonlyArray<ReactNativeSignal> = [
  {
    description: "bare `react-native` dependency",
    packageJsonExtras: { dependencies: { "react-native": "0.76.0" } },
  },
  {
    description: "`react-native-tvos` dependency",
    packageJsonExtras: { dependencies: { "react-native-tvos": "0.76.0-0" } },
  },
  {
    description: "`expo` + `expo-router` dependencies",
    packageJsonExtras: {
      dependencies: { expo: "^51.0.0", "expo-router": "^3.5.0" },
    },
  },
  {
    description: "`react-native` in `peerDependencies` only",
    packageJsonExtras: { peerDependencies: { "react-native": "*" } },
  },
  {
    description: "`react-native` in `devDependencies` only",
    packageJsonExtras: { devDependencies: { "react-native": "0.76.0" } },
  },
  {
    description: "`react-native` in `optionalDependencies` only",
    packageJsonExtras: { optionalDependencies: { "react-native": "0.76.0" } },
  },
  {
    description: "`@react-native-firebase/app` namespace dependency",
    packageJsonExtras: { dependencies: { "@react-native-firebase/app": "^21.0.0" } },
  },
  {
    description: "`@react-native/metro-config` namespace dependency",
    packageJsonExtras: { devDependencies: { "@react-native/metro-config": "^0.76.0" } },
  },
  {
    description: "Metro's top-level `react-native` resolution field (library manifest)",
    packageJsonExtras: { "react-native": "./dist/native/index.js" },
  },
];

describe("RN signal sync table: project-info and oxlint plugin RN detection MUST agree", () => {
  // Project-info side — discoverProject is what populates
  // `hasReactNativeWorkspace`. Exercising it inside a Next-rooted
  // workspace catches signals that classify the file as RN
  // (oxlint plugin) but never get the capability added
  // (project-info) — the silent drop that prevents the rule from
  // ever running.
  for (const signal of REACT_NATIVE_SIGNALS) {
    it(`discoverProject — ${signal.description} → hasReactNativeWorkspace: true`, () => {
      const rootDirectory = fs.mkdtempSync(path.join(tempRoot, "rn-signal-discover-"));
      const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
      fs.mkdirSync(mobileDirectory, { recursive: true });
      writeJson(path.join(rootDirectory, "package.json"), {
        name: "sync-root",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      });
      writeJson(path.join(mobileDirectory, "package.json"), {
        name: "mobile",
        dependencies: { react: "^19.0.0" },
        ...signal.packageJsonExtras,
      });

      const projectInfo = discoverProject(rootDirectory);
      expect(projectInfo.hasReactNativeWorkspace).toBe(true);
    });
  }

  // Plugin side — classifyPackagePlatform is called inside the rule
  // wrapper; the observable is whether `rn-no-raw-text` fires on a
  // file inside the workspace. Exercising it here catches the
  // inverse drift — a signal that's caught at the project level but
  // missed at the file level, which would mean rn-* rules load
  // globally and then over-fire on the same RN package.
  for (const signal of REACT_NATIVE_SIGNALS) {
    it(`classifyPackagePlatform — ${signal.description} → file classifies as RN`, async () => {
      const projectDirectory = setupReactProject(
        tempRoot,
        `rn-signal-classify-${signal.description.replace(/[^a-z0-9]/gi, "-")}`,
        {
          packageJsonExtras: {
            ...signal.packageJsonExtras,
            dependencies: {
              react: "^19.0.0",
              ...(signal.packageJsonExtras.dependencies ?? {}),
            },
          },
          files: {
            "src/Screen.tsx": `export const Screen = () => <View>raw</View>;\n`,
          },
        },
      );

      const diagnostics = await runOxlint({
        rootDirectory: projectDirectory,
        project: buildTestProject({ rootDirectory: projectDirectory, framework: "react-native" }),
      });
      expect(findDiagnosticsByRule(diagnostics, "rn-no-raw-text").length).toBeGreaterThan(0);
    });
  }
});
