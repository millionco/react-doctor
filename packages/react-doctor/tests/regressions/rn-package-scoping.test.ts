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
import type { Diagnostic } from "@react-doctor/core";
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
