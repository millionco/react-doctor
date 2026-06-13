import type { ProjectInfo } from "@react-doctor/core";

export const TEST_ROOT_DIRECTORY = "/home/user/app";

export const buildProject = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
  rootDirectory: TEST_ROOT_DIRECTORY,
  projectName: "app",
  reactVersion: "19.2.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: true,
  hasTanStackQuery: false,
  nextjsVersion: "15.0.0",
  nextjsMajorVersion: 15,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 10,
  ...overrides,
});

export const buildOxlintStdout = (code: string, message: string): string =>
  JSON.stringify({
    diagnostics: [
      {
        message,
        code,
        severity: "error",
        causes: [],
        url: "",
        help: "",
        filename: "src/components/widget.tsx",
        labels: [{ label: "", span: { offset: 0, length: 1, line: 12, column: 3 } }],
        related: [],
      },
    ],
    number_of_files: 1,
    number_of_rules: 1,
  });
