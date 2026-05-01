import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ReactDoctorConfig } from "../src/types.js";
import { filterIgnoredDiagnostics } from "../src/utils/filter-diagnostics.js";
import { createNodeReadFileLinesSync } from "../src/utils/read-file-lines-node.js";

const TEST_ROOT_DIRECTORY = "/home/user/project";
const testReadFileLines = createNodeReadFileLinesSync(TEST_ROOT_DIRECTORY);

const createDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react",
  rule: "no-danger",
  severity: "warning",
  message: "test message",
  help: "test help",
  line: 1,
  column: 1,
  category: "Correctness",
  ...overrides,
});

describe("filterIgnoredDiagnostics", () => {
  it("returns all diagnostics when config has no ignore rules", () => {
    const diagnostics = [createDiagnostic()];
    const config: ReactDoctorConfig = {};
    expect(
      filterIgnoredDiagnostics(diagnostics, config, TEST_ROOT_DIRECTORY, testReadFileLines),
    ).toEqual(diagnostics);
  });

  it("filters diagnostics matching ignored rules", () => {
    const diagnostics = [
      createDiagnostic({ plugin: "react", rule: "no-danger" }),
      createDiagnostic({ plugin: "jsx-a11y", rule: "no-autofocus" }),
      createDiagnostic({ plugin: "react-doctor", rule: "no-giant-component" }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        rules: ["react/no-danger", "jsx-a11y/no-autofocus"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-giant-component");
  });

  it("filters diagnostics matching ignored file patterns", () => {
    const diagnostics = [
      createDiagnostic({ filePath: "src/generated/types.tsx" }),
      createDiagnostic({ filePath: "src/generated/api/client.tsx" }),
      createDiagnostic({ filePath: "src/components/Button.tsx" }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        files: ["src/generated/**"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].filePath).toBe("src/components/Button.tsx");
  });

  it("filters by both rules and files together", () => {
    const diagnostics = [
      createDiagnostic({ plugin: "react", rule: "no-danger", filePath: "src/app.tsx" }),
      createDiagnostic({ plugin: "knip", rule: "exports", filePath: "src/generated/api.tsx" }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-giant-component",
        filePath: "src/components/App.tsx",
      }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        rules: ["react/no-danger"],
        files: ["src/generated/**"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-giant-component");
  });

  it("keeps all diagnostics when no rules or files match", () => {
    const diagnostics = [
      createDiagnostic({ plugin: "react", rule: "no-danger" }),
      createDiagnostic({ plugin: "knip", rule: "exports" }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        rules: ["nonexistent/rule"],
        files: ["nonexistent/**"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(2);
  });

  it("filters file paths with ./ prefix against patterns without it", () => {
    const diagnostics = [
      createDiagnostic({ filePath: "./resources/js/components/ui/Button.tsx" }),
      createDiagnostic({ filePath: "./resources/js/marketing/Hero.tsx" }),
      createDiagnostic({ filePath: "./resources/js/pages/Home.tsx" }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        files: ["resources/js/components/ui/**", "resources/js/marketing/**"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].filePath).toBe("./resources/js/pages/Home.tsx");
  });

  it("filters absolute file paths against relative patterns", () => {
    const rootDirectory = "/home/user/project";
    const diagnostics = [
      createDiagnostic({
        filePath: "/home/user/project/resources/js/components/ui/Button.tsx",
      }),
      createDiagnostic({
        filePath: "/home/user/project/resources/js/marketing/Hero.tsx",
      }),
      createDiagnostic({
        filePath: "/home/user/project/resources/js/pages/Home.tsx",
      }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        files: ["/resources/js/components/ui/**", "/resources/js/marketing/**"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      rootDirectory,
      createNodeReadFileLinesSync(rootDirectory),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].filePath).toContain("pages/Home.tsx");
  });

  it("handles knip rule identifiers", () => {
    const diagnostics = [
      createDiagnostic({ plugin: "knip", rule: "exports" }),
      createDiagnostic({ plugin: "knip", rule: "types" }),
      createDiagnostic({ plugin: "knip", rule: "files" }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        rules: ["knip/exports", "knip/types"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("files");
  });
});
