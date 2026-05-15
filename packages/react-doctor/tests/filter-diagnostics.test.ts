import { describe, expect, it } from "vite-plus/test";
import type { ReactDoctorConfig } from "../src/types/config.js";
import type { Diagnostic } from "../src/types/diagnostic.js";
import { filterIgnoredDiagnostics } from "../src/core/filter-diagnostics.js";
import { createNodeReadFileLinesSync } from "../src/core/read-file-lines-node.js";

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

  it("ignore.overrides scopes a rule to specific files without losing coverage of unrelated rules", () => {
    const diagnostics = [
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-array-index-as-key",
        filePath: "components/diff/Hunk.tsx",
      }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-cascading-set-state",
        filePath: "components/diff/Hunk.tsx",
      }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-array-index-as-key",
        filePath: "components/list/Items.tsx",
      }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        overrides: [
          {
            files: ["components/diff/**"],
            rules: ["react-doctor/no-array-index-as-key"],
          },
        ],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );

    expect(filtered).toHaveLength(2);
    expect(
      filtered.some(
        (diagnostic) =>
          diagnostic.filePath === "components/diff/Hunk.tsx" &&
          diagnostic.rule === "no-array-index-as-key",
      ),
    ).toBe(false);
    expect(
      filtered.some(
        (diagnostic) =>
          diagnostic.filePath === "components/diff/Hunk.tsx" &&
          diagnostic.rule === "no-cascading-set-state",
      ),
    ).toBe(true);
    expect(
      filtered.some(
        (diagnostic) =>
          diagnostic.filePath === "components/list/Items.tsx" &&
          diagnostic.rule === "no-array-index-as-key",
      ),
    ).toBe(true);
  });

  it("ignore.overrides with no rules list suppresses every rule for the matched files", () => {
    const diagnostics = [
      createDiagnostic({ plugin: "react", rule: "no-danger", filePath: "src/legacy/A.tsx" }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-cascading-set-state",
        filePath: "src/legacy/A.tsx",
      }),
      createDiagnostic({ plugin: "react", rule: "no-danger", filePath: "src/modern/B.tsx" }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        overrides: [{ files: ["src/legacy/**"] }],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].filePath).toBe("src/modern/B.tsx");
  });

  it("ignore.overrides emits stderr warnings for malformed entries instead of silently treating rules-as-string as 'ignore everything'", () => {
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrWrites.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const diagnostics = [
        createDiagnostic({
          plugin: "react-doctor",
          rule: "no-array-index-as-key",
          filePath: "components/diff/A.tsx",
        }),
        createDiagnostic({
          plugin: "react-doctor",
          rule: "no-cascading-set-state",
          filePath: "components/diff/A.tsx",
        }),
      ];
      const config: ReactDoctorConfig = {
        ignore: {
          overrides: [
            {
              files: ["components/diff/**"],
              // @ts-expect-error: intentionally malformed for the validation test.
              rules: "react-doctor/no-array-index-as-key",
            },
          ],
        },
      };

      const filtered = filterIgnoredDiagnostics(
        diagnostics,
        config,
        TEST_ROOT_DIRECTORY,
        testReadFileLines,
      );

      const combinedStderr = stderrWrites.join("");
      expect(combinedStderr).toContain("ignore.overrides[0].rules");
      // Both diagnostics drop because the malformed entry was treated as
      // "no rules listed" → suppress every rule for matched files. The
      // warning above tells the user that's why.
      expect(filtered).toHaveLength(0);
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("ignore.overrides accepts multiple entries and combines them additively", () => {
    const diagnostics = [
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-array-index-as-key",
        filePath: "components/diff/A.tsx",
      }),
      createDiagnostic({
        plugin: "react",
        rule: "no-danger",
        filePath: "components/search/Highlight.tsx",
      }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-cascading-set-state",
        filePath: "components/search/Highlight.tsx",
      }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        overrides: [
          {
            files: ["components/diff/**"],
            rules: ["react-doctor/no-array-index-as-key"],
          },
          {
            files: ["components/search/Highlight.tsx"],
            rules: ["react/no-danger"],
          },
        ],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-cascading-set-state");
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
