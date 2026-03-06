import { describe, expect, it } from "vitest";
import type { Diagnostic, ReactDoctorConfig } from "../src/types.js";
import { filterIgnoredDiagnostics } from "../src/utils/filter-diagnostics.js";

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
    expect(filterIgnoredDiagnostics(diagnostics, config)).toEqual(diagnostics);
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

    const filtered = filterIgnoredDiagnostics(diagnostics, config);
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

    const filtered = filterIgnoredDiagnostics(diagnostics, config);
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

    const filtered = filterIgnoredDiagnostics(diagnostics, config);
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

    const filtered = filterIgnoredDiagnostics(diagnostics, config);
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

    const filtered = filterIgnoredDiagnostics(diagnostics, config);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].filePath).toBe("./resources/js/pages/Home.tsx");
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

    const filtered = filterIgnoredDiagnostics(diagnostics, config);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("files");
  });

  describe("overrides", () => {
    it("ignores a specific rule only for matching files", () => {
      const diagnostics = [
        createDiagnostic({
          plugin: "react-doctor",
          rule: "no-giant-component",
          filePath: "src/legacy/Dashboard.tsx",
        }),
        createDiagnostic({
          plugin: "react-doctor",
          rule: "no-giant-component",
          filePath: "src/components/App.tsx",
        }),
      ];
      const config: ReactDoctorConfig = {
        overrides: [
          {
            files: ["src/legacy/**"],
            ignore: { rules: ["react-doctor/no-giant-component"] },
          },
        ],
      };

      const filtered = filterIgnoredDiagnostics(diagnostics, config);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].filePath).toBe("src/components/App.tsx");
    });

    it("applies multiple overrides to different file patterns", () => {
      const diagnostics = [
        createDiagnostic({
          plugin: "react",
          rule: "no-danger",
          filePath: "src/legacy/Old.tsx",
        }),
        createDiagnostic({
          plugin: "knip",
          rule: "exports",
          filePath: "src/generated/api.tsx",
        }),
        createDiagnostic({
          plugin: "react-doctor",
          rule: "no-giant-component",
          filePath: "src/components/App.tsx",
        }),
      ];
      const config: ReactDoctorConfig = {
        overrides: [
          {
            files: ["src/legacy/**"],
            ignore: { rules: ["react/no-danger"] },
          },
          {
            files: ["src/generated/**"],
            ignore: { rules: ["knip/exports"] },
          },
        ],
      };

      const filtered = filterIgnoredDiagnostics(diagnostics, config);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].filePath).toBe("src/components/App.tsx");
    });

    it("combines overrides with global ignore.rules and ignore.files", () => {
      const diagnostics = [
        createDiagnostic({
          plugin: "react",
          rule: "no-danger",
          filePath: "src/app.tsx",
        }),
        createDiagnostic({
          plugin: "knip",
          rule: "exports",
          filePath: "src/generated/api.tsx",
        }),
        createDiagnostic({
          plugin: "react-doctor",
          rule: "no-giant-component",
          filePath: "src/legacy/Dashboard.tsx",
        }),
        createDiagnostic({
          plugin: "jsx-a11y",
          rule: "no-autofocus",
          filePath: "src/components/Search.tsx",
        }),
      ];
      const config: ReactDoctorConfig = {
        ignore: {
          rules: ["react/no-danger"],
          files: ["src/generated/**"],
        },
        overrides: [
          {
            files: ["src/legacy/**"],
            ignore: { rules: ["react-doctor/no-giant-component"] },
          },
        ],
      };

      const filtered = filterIgnoredDiagnostics(diagnostics, config);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].rule).toBe("no-autofocus");
    });

    it("has no effect when overrides array is empty", () => {
      const diagnostics = [
        createDiagnostic({ plugin: "react", rule: "no-danger" }),
        createDiagnostic({ plugin: "knip", rule: "exports" }),
      ];
      const config: ReactDoctorConfig = { overrides: [] };

      const filtered = filterIgnoredDiagnostics(diagnostics, config);
      expect(filtered).toHaveLength(2);
    });

    it("supports multiple file globs in a single override", () => {
      const diagnostics = [
        createDiagnostic({
          plugin: "react",
          rule: "no-danger",
          filePath: "src/legacy/Old.tsx",
        }),
        createDiagnostic({
          plugin: "react",
          rule: "no-danger",
          filePath: "src/deprecated/Stale.tsx",
        }),
        createDiagnostic({
          plugin: "react",
          rule: "no-danger",
          filePath: "src/components/App.tsx",
        }),
      ];
      const config: ReactDoctorConfig = {
        overrides: [
          {
            files: ["src/legacy/**", "src/deprecated/**"],
            ignore: { rules: ["react/no-danger"] },
          },
        ],
      };

      const filtered = filterIgnoredDiagnostics(diagnostics, config);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].filePath).toBe("src/components/App.tsx");
    });
  });
});
