import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { discoverProject, runOxlint } from "@react-doctor/core";
import type { ProjectInfo } from "@react-doctor/core";
import { setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-react-compiler-context-"));

const providerSource = `
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

interface AppStateContextValue {
  readonly presentationMode: boolean;
  readonly setPresentationMode: (active: boolean) => void;
}

const AppStateContext = createContext<AppStateContextValue>({
  presentationMode: false,
  setPresentationMode: () => {},
});

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const [presentationModeActive, setPresentationModeActive] = useState(false);
  const contextValue: AppStateContextValue = {
    presentationMode: presentationModeActive,
    setPresentationMode: setPresentationModeActive,
  };

  return <AppStateContext.Provider value={contextValue}>{children}</AppStateContext.Provider>;
};

export const useAppState = () => useContext(AppStateContext);
`;

const compilerConfigSource = `
import { createRequire } from "node:module";

const packageRequire = createRequire(import.meta.url);
const reactCompilerPlugin = packageRequire.resolve("babel-plugin-react-compiler");

export default {
  plugins: [
    {
      babel: {
        plugins: [[reactCompilerPlugin, { target: "19" }]],
      },
    },
  ],
};
`;

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const getContextProviderDiagnostics = async (
  project: ProjectInfo,
): Promise<Awaited<ReturnType<typeof runOxlint>>> => {
  const diagnostics = await runOxlint({
    rootDirectory: project.rootDirectory,
    project,
  });
  return diagnostics.filter(
    (diagnostic) => diagnostic.rule === "context-provider-value-from-unmemoized-local-literal",
  );
};

describe("issue #1448: compiler-gated context provider diagnostics", () => {
  it("reports the provider without an active compiler transform", async () => {
    const projectDirectory = setupReactProject(tempRoot, "without-react-compiler", {
      files: { "src/app-state-provider.tsx": providerSource },
    });
    const project = discoverProject(projectDirectory);

    expect(project.hasReactCompiler).toBe(false);
    expect(await getContextProviderDiagnostics(project)).toHaveLength(1);
  });

  it("suppresses the provider when createRequire resolves the compiler transform", async () => {
    const projectDirectory = setupReactProject(tempRoot, "with-react-compiler", {
      files: {
        "src/app-state-provider.tsx": providerSource,
        "vite.config.ts": compilerConfigSource,
      },
    });
    const project = discoverProject(projectDirectory);

    expect(project.hasReactCompiler).toBe(true);
    expect(await getContextProviderDiagnostics(project)).toEqual([]);
  });
});
