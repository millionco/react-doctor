import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { buildDiagnoseProjectPlan } from "../src/build-diagnose-project-plan.js";

const temporaryDirectories: string[] = [];

const createProject = (rootDirectory: string, name: string, sourceFileCount: number): string => {
  const projectDirectory = path.join(rootDirectory, "packages", name);
  const sourceDirectory = path.join(projectDirectory, "src");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({ name, dependencies: { react: "19.0.0" } }),
  );
  for (let fileIndex = 0; fileIndex < sourceFileCount; fileIndex += 1) {
    fs.writeFileSync(
      path.join(sourceDirectory, `component-${fileIndex}.tsx`),
      `export const Component${fileIndex} = () => <div />;\n`,
    );
  }
  return projectDirectory;
};

const createWorkspace = (): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-api-plan-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(
    path.join(rootDirectory, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\n',
  );
  return rootDirectory;
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("buildDiagnoseProjectPlan", () => {
  it("schedules larger sibling projects first and retains original indexes", async () => {
    const rootDirectory = createWorkspace();
    const smallProject = createProject(rootDirectory, "small", 1);
    const largeProject = createProject(rootDirectory, "large", 3);

    const plan = await buildDiagnoseProjectPlan([
      { directory: smallProject },
      { directory: largeProject },
    ]);

    expect(plan.map((entry) => entry.projectDefinition.directory)).toEqual([
      largeProject,
      smallProject,
    ]);
    expect(plan.map((entry) => entry.originalIndex)).toEqual([1, 0]);
    expect(plan.map((entry) => entry.precomputedSourceFiles?.length)).toEqual([3, 1]);
    expect(plan[0].precomputedSourceFiles?.map((sourceFile) => sourceFile.path)).toEqual([
      "src/component-0.tsx",
      "src/component-1.tsx",
      "src/component-2.tsx",
    ]);
  });

  it("keeps nested project counts on the existing per-scan path", async () => {
    const rootDirectory = createWorkspace();
    const parentProject = createProject(rootDirectory, "parent", 1);
    const nestedProject = createProject(parentProject, "nested", 2);

    const plan = await buildDiagnoseProjectPlan([
      { directory: parentProject },
      { directory: nestedProject },
    ]);

    expect(plan.map((entry) => entry.projectDefinition.directory)).toEqual([
      parentProject,
      nestedProject,
    ]);
    expect(plan.every((entry) => entry.precomputedSourceFiles === undefined)).toBe(true);
  });

  it("falls back to project-local discovery for empty shared inventories", async () => {
    const rootDirectory = createWorkspace();
    const emptyProject = createProject(rootDirectory, "empty", 0);
    const populatedProject = createProject(rootDirectory, "populated", 1);

    const plan = await buildDiagnoseProjectPlan([
      { directory: emptyProject },
      { directory: populatedProject },
    ]);

    const emptyProjectPlanEntry = plan.find(
      (entry) => entry.projectDefinition.directory === emptyProject,
    );
    const populatedProjectPlanEntry = plan.find(
      (entry) => entry.projectDefinition.directory === populatedProject,
    );
    expect(emptyProjectPlanEntry?.precomputedSourceFiles).toBeUndefined();
    expect(populatedProjectPlanEntry?.precomputedSourceFiles).toHaveLength(1);
  });
});
