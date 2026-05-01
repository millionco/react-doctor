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

import type { ReactDoctorConfig } from "../../src/types.js";
import { checkReducedMotion } from "../../src/utils/check-reduced-motion.js";
import { filterIgnoredDiagnostics } from "../../src/utils/filter-diagnostics.js";
import { buildDiagnostic, initGitRepo, writeFile, writeJson } from "./_helpers.js";

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
