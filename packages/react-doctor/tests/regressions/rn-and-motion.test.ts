/**
 * Regression tests for React Native text-component allowlisting and the
 * Motion accessibility check.
 *
 * Covered closed issues:
 *   #93 + #100 — `textComponents` config must allowlist user-defined RN
 *                text wrappers (custom Typography component, member-
 *                expression names like `NativeTabs.Trigger.Label`)
 *   #183     — `rawTextWrapperComponents` suppresses string-only wrapper
 *              children
 *   #581     — fbtee `<fbt>` / `<fbs>` translation tags stay transparent to
 *              the `<Text>` boundary (so raw text inside them isn't flagged)
 *   #76      — maintained Expo packages are not treated as legacy packages
 *   #94      — `MotionConfig reducedMotion="user"` must satisfy the
 *              reduced-motion accessibility check (so the rule doesn't
 *              false-positive when handling is delegated to the provider)
 *   #696     — `git grep` must also search untracked files so that newly
 *              created source (e.g. a `providers.tsx` not yet committed)
 *              is found by the reduced-motion grep
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { ReactDoctorConfig } from "@react-doctor/core";
import {
  checkReducedMotion,
  createNodeReadFileLinesSync,
  mergeAndFilterDiagnostics,
  runOxlint,
} from "@react-doctor/core";

// Adapter so the existing test bodies stay readable. The legacy
// `filterIgnoredDiagnostics` helper applied only ignore filters + the
// `rn-no-raw-text` text-component / wrapper checks; today both live in
// the unified pipeline reachable through `mergeAndFilterDiagnostics`
// (with inline disables off, since the legacy helper did not look at
// inline directives).
const filterIgnoredDiagnostics = (
  diagnostics: Parameters<typeof mergeAndFilterDiagnostics>[0],
  config: Parameters<typeof mergeAndFilterDiagnostics>[2],
  rootDirectory: Parameters<typeof mergeAndFilterDiagnostics>[1],
  readFileLinesSync: Parameters<typeof mergeAndFilterDiagnostics>[3],
) =>
  mergeAndFilterDiagnostics(diagnostics, rootDirectory, config, readFileLinesSync, {
    respectInlineDisables: false,
  });
import {
  buildDiagnostic,
  buildTestProject,
  initGitRepo,
  setupReactProject,
  writeFile,
  writeJson,
} from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-rn-motion-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const buildRnTextDiagnostic = (overrides: Parameters<typeof buildDiagnostic>[0] = {}) =>
  buildDiagnostic({
    rule: "rn-no-raw-text",
    severity: "error",
    column: 0,
    category: "React Native",
    ...overrides,
  });

const stubReadFileLines = (content: string) => () => content.split("\n");
const VIRTUAL_ROOT = "/virtual/project";

describe("issue #93 + #100: textComponents allowlists custom RN text wrappers", () => {
  it("does not fire rn-no-raw-text inside a custom <Typography> when 'Typography' is allowlisted", () => {
    const config: ReactDoctorConfig = { textComponents: ["Typography"] };
    const file = `<Typography>Hello world</Typography>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 1 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(0);
  });

  it("recognizes member-expression components by their LEAF name (NativeTabs.Trigger.Label → 'Label')", () => {
    const config: ReactDoctorConfig = { textComponents: ["Label"] };
    const file = `<NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 1 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(0);
  });

  it("recognizes member-expression components by their FULL dotted name (NativeTabs.Trigger.Label)", () => {
    const config: ReactDoctorConfig = { textComponents: ["NativeTabs.Trigger.Label"] };
    const file = `<NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 1 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(0);
  });

  it("still flags raw text inside a non-allowlisted component", () => {
    const config: ReactDoctorConfig = { textComponents: ["Typography"] };
    const file = `<View>Hello</View>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 1 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(1);
  });
});

describe("issue #183: rawTextWrapperComponents suppresses string-only wrapper children", () => {
  it("suppresses raw string children inside configured raw text wrappers", () => {
    const config: ReactDoctorConfig = { rawTextWrapperComponents: ["Button"] };
    const file = `<Button>Cancel</Button>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 1 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(0);
  });

  it("suppresses raw template-literal children inside configured raw text wrappers", () => {
    const config: ReactDoctorConfig = { rawTextWrapperComponents: ["Button"] };
    const file = "<Button>{`Save changes`}</Button>\n";
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 1 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(0);
  });

  it("recognizes wrappers by their LEAF name when the JSX uses a member expression", () => {
    const config: ReactDoctorConfig = { rawTextWrapperComponents: ["Button"] };
    const file = `<HeroUi.Button>Cancel</HeroUi.Button>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 1 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(0);
  });

  it("still reports raw text inside a wrapper that ALSO contains a JSX child element", () => {
    const config: ReactDoctorConfig = { rawTextWrapperComponents: ["Button"] };
    const file = `<Button>\n  Save\n  <Icon />\n</Button>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 2 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(1);
  });

  it("does not affect wrappers that aren't listed", () => {
    const config: ReactDoctorConfig = { rawTextWrapperComponents: ["Button"] };
    const file = `<Card>Cancel</Card>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 1 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(1);
  });

  it("does NOT suppress raw text whose enclosing parent is a non-wrapper, even when a SIBLING is a configured wrapper (closed-sibling regression)", () => {
    const config: ReactDoctorConfig = { rawTextWrapperComponents: ["Button"] };
    const file = `<View>\n  <Button>Inner</Button>\n  Save\n</View>\n`;
    const filtered = filterIgnoredDiagnostics(
      [buildRnTextDiagnostic({ line: 3 })],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(1);
  });

  it("end-to-end: a real oxlint run on a React Native project gets its rn-no-raw-text diagnostics suppressed when `rawTextWrapperComponents` matches", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-183-e2e", {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "0.76.0" } },
      files: {
        "src/App.tsx": `export const App = () => <Button>Cancel</Button>;\n`,
      },
    });

    const rawDiagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({
        rootDirectory: projectDir,
        framework: "react-native",
      }),
    });
    const rnRawTextDiagnostics = rawDiagnostics.filter(
      (diagnostic) => diagnostic.rule === "rn-no-raw-text",
    );
    expect(rnRawTextDiagnostics.length).toBeGreaterThan(0);

    const filtered = mergeAndFilterDiagnostics(
      rawDiagnostics,
      projectDir,
      { rawTextWrapperComponents: ["Button"] },
      createNodeReadFileLinesSync(projectDir),
    );
    const remainingRnRawText = filtered.filter(
      (diagnostic) => diagnostic.rule === "rn-no-raw-text",
    );
    expect(remainingRnRawText).toHaveLength(0);
  });

  it("composes with textComponents (each suppresses its own diagnostics)", () => {
    const config: ReactDoctorConfig = {
      textComponents: ["Typography"],
      rawTextWrapperComponents: ["Button"],
    };
    const file = `<Typography>Hello</Typography>\n<Button>Cancel</Button>\n<View>Bad</View>\n`;
    const filtered = filterIgnoredDiagnostics(
      [
        buildRnTextDiagnostic({ line: 1 }),
        buildRnTextDiagnostic({ line: 2 }),
        buildRnTextDiagnostic({ line: 3 }),
      ],
      config,
      VIRTUAL_ROOT,
      stubReadFileLines(file),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].line).toBe(3);
  });
});

describe("issue #581: fbtee tags stay transparent inside <Text>", () => {
  const buildFbteeProject = (projectName: string, appSource: string) =>
    setupReactProject(tempRoot, projectName, {
      packageJsonExtras: { dependencies: { react: "^19.0.0", "react-native": "^0.79.0" } },
      files: { "src/App.tsx": appSource },
    });

  const getRnNoRawTextDiagnostics = async (projectDirectory: string) => {
    const diagnostics = await runOxlint({
      rootDirectory: projectDirectory,
      project: buildTestProject({
        rootDirectory: projectDirectory,
        framework: "react-native",
      }),
    });
    return diagnostics.filter((diagnostic) => diagnostic.rule === "rn-no-raw-text");
  };

  it("does not report raw text inside <Text><fbt>...</fbt></Text>", async () => {
    const projectDirectory = buildFbteeProject(
      "issue-581-fbt-inside-text",
      `import { Text } from "react-native";

export const App = () => (
  <Text>
    <fbt desc="Greeting">Welcome</fbt>
  </Text>
);
`,
    );

    const diagnostics = await getRnNoRawTextDiagnostics(projectDirectory);
    expect(diagnostics).toHaveLength(0);
  });

  it("does not report raw text inside namespaced fbtee tags within <Text>", async () => {
    const projectDirectory = buildFbteeProject(
      "issue-581-fbt-param-inside-text",
      `import { Text } from "react-native";

export const App = () => (
  <Text>
    <fbt desc="Greeting">
      <fbt:param name="word">Welcome</fbt:param>
    </fbt>
  </Text>
);
`,
    );

    const diagnostics = await getRnNoRawTextDiagnostics(projectDirectory);
    expect(diagnostics).toHaveLength(0);
  });

  it("still reports raw text when <fbt> is outside <Text>", async () => {
    const projectDirectory = buildFbteeProject(
      "issue-581-fbt-outside-text",
      `export const App = () => <fbt desc="Greeting">Welcome</fbt>;
`,
    );

    const diagnostics = await getRnNoRawTextDiagnostics(projectDirectory);
    expect(diagnostics).toHaveLength(1);
  });
});

describe("issue #76: @expo/vector-icons is not treated as a legacy Expo package", () => {
  it("does not flag @expo/vector-icons while still flagging deprecated Expo packages", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-76-vector-icons", {
      files: {
        "src/App.tsx": `import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Audio } from "expo-av";

export const App = () => (
  <>
    <Ionicons name="home" size={24} />
    <LinearGradient colors={["red", "blue"]} />
    <Audio.Sound />
  </>
);
`,
      },
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          "react-native": "^0.79.0",
          "@expo/vector-icons": "^14.0.0",
          "expo-linear-gradient": "^15.0.7",
          "expo-av": "^15.0.0",
        },
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({
        rootDirectory: projectDir,
        framework: "react-native",
      }),
    });

    const legacyExpoIssues = diagnostics.filter(
      (diagnostic) => diagnostic.rule === "rn-no-legacy-expo-packages",
    );
    expect(
      legacyExpoIssues.some((diagnostic) => diagnostic.message.includes("@expo/vector-icons")),
    ).toBe(false);
    expect(
      legacyExpoIssues.some((diagnostic) => diagnostic.message.includes("expo-linear-gradient")),
    ).toBe(false);
    expect(legacyExpoIssues.some((diagnostic) => diagnostic.message.includes("expo-av"))).toBe(
      true,
    );
  });
});

describe("FlashList v2 sizing hints", () => {
  it("does not emit rn-list-missing-estimated-item-size for @shopify/flash-list v2", async () => {
    const projectDir = setupReactProject(tempRoot, "flash-list-v2", {
      files: {
        "src/App.tsx": `import { FlashList } from "@shopify/flash-list";
import { Text } from "react-native";

export const App = ({ items }) => (
  <FlashList data={items} renderItem={({ item }) => <Text>{item.title}</Text>} />
);
`,
      },
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          "react-native": "^0.79.0",
          "@shopify/flash-list": "^2.0.0",
        },
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({
        rootDirectory: projectDir,
        framework: "react-native",
        shopifyFlashListVersion: "^2.0.0",
        shopifyFlashListMajorVersion: 2,
      }),
    });

    expect(
      diagnostics.some((diagnostic) => diagnostic.rule === "rn-list-missing-estimated-item-size"),
    ).toBe(false);
  });
});

describe("issue #94: MotionConfig satisfies the reduced-motion accessibility check", () => {
  it("does not emit require-reduced-motion when MotionConfig is present in source", () => {
    const projectDir = path.join(tempRoot, "issue-94-positive");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {
      name: "issue-94-positive",
      dependencies: { react: "^19.0.0", "framer-motion": "^11.0.0" },
    });
    writeFile(
      path.join(projectDir, "src", "App.tsx"),
      `import { MotionConfig } from "framer-motion";
export const App = () => (
  <MotionConfig reducedMotion="user">
    <div />
  </MotionConfig>
);
`,
    );
    initGitRepo(projectDir, { commit: true });

    const diagnostics = checkReducedMotion(projectDir);
    expect(diagnostics).toHaveLength(0);
  });

  it("does not emit require-reduced-motion when useReducedMotion is present in source", () => {
    const projectDir = path.join(tempRoot, "issue-94-use-reduced-motion");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {
      name: "issue-94-use-reduced-motion",
      dependencies: { react: "^19.0.0", "framer-motion": "^11.0.0" },
    });
    writeFile(
      path.join(projectDir, "src", "App.tsx"),
      `import { useReducedMotion } from "framer-motion";
export const App = () => {
  const shouldReduceMotion = useReducedMotion();
  return <div data-reduce-motion={String(shouldReduceMotion)} />;
};
`,
    );
    initGitRepo(projectDir, { commit: true });

    const diagnostics = checkReducedMotion(projectDir);
    expect(diagnostics).toHaveLength(0);
  });

  it("does not emit require-reduced-motion when prefers-reduced-motion appears in CSS", () => {
    const projectDir = path.join(tempRoot, "issue-94-css-media-query");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {
      name: "issue-94-css-media-query",
      dependencies: { react: "^19.0.0", motion: "^12.0.0" },
    });
    writeFile(
      path.join(projectDir, "src", "styles.css"),
      `@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms;
  }
}
`,
    );
    initGitRepo(projectDir, { commit: true });

    const diagnostics = checkReducedMotion(projectDir);
    expect(diagnostics).toHaveLength(0);
  });

  it("emits require-reduced-motion when motion library is present without ANY handling", () => {
    const projectDir = path.join(tempRoot, "issue-94-negative");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {
      name: "issue-94-negative",
      dependencies: { react: "^19.0.0", "framer-motion": "^11.0.0" },
    });
    writeFile(path.join(projectDir, "src", "App.tsx"), `export const App = () => null;\n`);
    initGitRepo(projectDir, { commit: true });

    const diagnostics = checkReducedMotion(projectDir);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].rule).toBe("require-reduced-motion");
  });

  it("does not emit require-reduced-motion when MotionConfig is in an UNTRACKED file (#696)", () => {
    const projectDir = path.join(tempRoot, "issue-696-untracked");
    fs.mkdirSync(path.join(projectDir, "src/components"), { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {
      name: "issue-696-untracked",
      dependencies: { react: "^19.0.0", motion: "^12.0.0" },
    });
    initGitRepo(projectDir, { commit: true });

    writeFile(
      path.join(projectDir, "src/components", "providers.tsx"),
      `"use client";

import { MotionConfig } from "motion/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
`,
    );

    const diagnostics = checkReducedMotion(projectDir);
    expect(diagnostics).toHaveLength(0);
  });

  it("does not emit require-reduced-motion when no motion library is in dependencies", () => {
    const projectDir = path.join(tempRoot, "issue-94-no-lib");
    fs.mkdirSync(projectDir, { recursive: true });
    writeJson(path.join(projectDir, "package.json"), {
      name: "issue-94-no-lib",
      dependencies: { react: "^19.0.0" },
    });

    const diagnostics = checkReducedMotion(projectDir);
    expect(diagnostics).toHaveLength(0);
  });
});
