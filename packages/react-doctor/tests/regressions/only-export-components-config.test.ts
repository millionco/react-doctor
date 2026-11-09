import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-only-export-components-config-"));
const RULE_ID = "only-export-components";

const REACT_NATIVE_DEPENDENCIES = {
  react: "^19.0.0",
  "react-native": "^0.79.0",
};

const HOC_WRAPPED_SCREEN = `import { Text } from "react-native";
import { withNetworkBoundary } from "./with-network-boundary";
import { withScreenBoundary } from "./with-screen-boundary";

function ScreenContent() {
  return <Text>screen</Text>;
}

function CardContent() {
  return <Text>card</Text>;
}

export function ScreenHeader() {
  return <Text>header</Text>;
}

export const Screen = withScreenBoundary(ScreenContent);
export const Card = withNetworkBoundary(CardContent, { fallback: null });
`;

const collectOnlyExportComponentsIssues = async (
  projectDirectory: string,
  userConfig: ReactDoctorConfig | null,
): Promise<Diagnostic[]> => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDirectory,
    project: buildTestProject({ rootDirectory: projectDirectory, framework: "react-native" }),
    userConfig,
  });
  return diagnostics.filter((diagnostic) => diagnostic.rule === RULE_ID);
};

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("only-export-components config", () => {
  it("reports exports wrapped in project HOCs when no customHOCs are configured", async () => {
    const projectDirectory = setupReactProject(tempRoot, "without-custom-hocs", {
      packageJsonExtras: { dependencies: REACT_NATIVE_DEPENDENCIES },
      files: { "src/screen.tsx": HOC_WRAPPED_SCREEN },
    });

    const issues = await collectOnlyExportComponentsIssues(projectDirectory, null);
    expect(issues.map((issue) => issue.line)).toEqual([17, 18]);
  });

  it("treats exports wrapped in configured customHOCs as components", async () => {
    const projectDirectory = setupReactProject(tempRoot, "with-custom-hocs", {
      packageJsonExtras: { dependencies: REACT_NATIVE_DEPENDENCIES },
      files: { "src/screen.tsx": HOC_WRAPPED_SCREEN },
    });

    const issues = await collectOnlyExportComponentsIssues(projectDirectory, {
      onlyExportComponents: { customHOCs: ["withScreenBoundary", "withNetworkBoundary"] },
    });
    expect(issues).toEqual([]);
  });
});
