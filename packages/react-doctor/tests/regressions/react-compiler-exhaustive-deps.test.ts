import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { discoverProject, runOxlint } from "@react-doctor/core";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import { REACT_COMPILER_VITE_CONFIG, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-react-compiler-deps-"));

const EXHAUSTIVE_DEPS_RULE = "exhaustive-deps";
const FRESH_DEPS_RULE = "no-effect-with-fresh-deps";

const componentSource = `
import { useEffect, useMemo, useCallback } from "react";

export const MyComponent = ({ count, name }) => {
  // Fresh deps: Date created every render
  const timestamp = useMemo(() => new Date(), [new Date()]);

  // Fresh deps: inline callback
  const handler = useCallback(() => {
    console.log(count);
  }, [() => console.log("nested")]);

  // Missing deps
  useEffect(() => {
    console.log(count, name);
  }, []);

  return <div>{timestamp.toISOString()}</div>;
};
`;

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const getExhaustiveDepsAndFreshDeps = async (project: ProjectInfo): Promise<Diagnostic[]> => {
  const diagnostics = await runOxlint({
    rootDirectory: project.rootDirectory,
    project,
  });
  return diagnostics.filter(
    (diagnostic) => diagnostic.rule === EXHAUSTIVE_DEPS_RULE || diagnostic.rule === FRESH_DEPS_RULE,
  );
};

describe("issue #1591: React Compiler should suppress exhaustive-deps and no-effect-with-fresh-deps", () => {
  it("reports dependency issues without an active compiler transform", async () => {
    const projectDirectory = setupReactProject(tempRoot, "without-react-compiler", {
      files: { "src/my-component.tsx": componentSource },
    });
    const project = discoverProject(projectDirectory);

    expect(project.hasReactCompiler).toBe(false);
    const diagnostics = await getExhaustiveDepsAndFreshDeps(project);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.rule === EXHAUSTIVE_DEPS_RULE)).toBe(true);
    expect(diagnostics.some((d) => d.rule === FRESH_DEPS_RULE)).toBe(true);
  });

  it("suppresses dependency issues when React Compiler is active", async () => {
    const projectDirectory = setupReactProject(tempRoot, "with-react-compiler", {
      files: {
        "src/my-component.tsx": componentSource,
        "vite.config.ts": REACT_COMPILER_VITE_CONFIG,
      },
    });
    const project = discoverProject(projectDirectory);

    expect(project.hasReactCompiler).toBe(true);
    expect(await getExhaustiveDepsAndFreshDeps(project)).toEqual([]);
  });
});
