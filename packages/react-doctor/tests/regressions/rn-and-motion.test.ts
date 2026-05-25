/**
 * Regression tests for React Native text-component allowlisting and the
 * Motion accessibility check.
 *
 * Covered closed issues:
 *   #93 + #100 — `textComponents` config must allowlist user-defined RN
 *                text wrappers (custom Typography component, member-
 *                expression names like `NativeTabs.Trigger.Label`)
 *   #94      — `MotionConfig reducedMotion="user"` must satisfy the
 *              reduced-motion accessibility check (so the rule doesn't
 *              false-positive when handling is delegated to the provider)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { checkReducedMotion, runOxlint } from "@react-doctor/core";
import {
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

describe("React Native text-component configuration", () => {
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

    const configuredDiagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({
        rootDirectory: projectDir,
        framework: "react-native",
      }),
      userConfig: { rawTextWrapperComponents: ["Button"] },
    });
    const remainingRnRawText = configuredDiagnostics.filter(
      (diagnostic) => diagnostic.rule === "rn-no-raw-text",
    );
    expect(remainingRnRawText).toHaveLength(0);
  });
});

describe("issue #76: @expo/vector-icons is not treated as a legacy Expo package", () => {
  it("does not flag @expo/vector-icons while still flagging deprecated Expo packages", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-76-vector-icons", {
      files: {
        "src/App.tsx": `import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";

export const App = () => (
  <>
    <Ionicons name="home" size={24} />
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
    expect(legacyExpoIssues.some((diagnostic) => diagnostic.message.includes("expo-av"))).toBe(
      true,
    );
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
