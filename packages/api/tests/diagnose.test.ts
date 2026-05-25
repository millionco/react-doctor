import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { diagnose, NoReactDependencyError, ProjectNotFoundError } from "../src/index.js";
import { clearConfigCache } from "@react-doctor/core";

const FIXTURES_DIRECTORY = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "react-doctor",
  "tests",
  "fixtures",
);

const noReactTempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rdc-api-test-"));
fs.writeFileSync(
  path.join(noReactTempDirectory, "package.json"),
  JSON.stringify({ name: "no-react", dependencies: {} }),
);

const forbiddenWordPlugin = `
const noForbiddenWordRule = {
  create: (context) => ({
    JSXText(node) {
      if (typeof node.value !== "string") return;
      if (node.value.includes("FORBIDDEN")) {
        context.report({
          node,
          message: "team policy: 'FORBIDDEN' is not allowed in JSX text",
        });
      }
    },
  }),
};

module.exports = {
  meta: { name: "team-conventions" },
  rules: {
    "no-forbidden-word": noForbiddenWordRule,
  },
};
`;

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
};

afterAll(() => {
  fs.rmSync(noReactTempDirectory, { recursive: true, force: true });
});

describe("diagnose", () => {
  it("returns a DiagnoseResult with the expected shape on basic-react", async () => {
    const result = await diagnose(path.join(FIXTURES_DIRECTORY, "basic-react"), {
      deadCode: false,
      lint: false,
    });
    expect(result).toHaveProperty("diagnostics");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("project");
    expect(result).toHaveProperty("skippedChecks");
    expect(result).toHaveProperty("elapsedMilliseconds");
    expect(result.project.reactMajorVersion).toBe(19);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it("throws NoReactDependencyError when the directory has package.json without react", async () => {
    await expect(diagnose(noReactTempDirectory, { lint: false })).rejects.toThrow(
      NoReactDependencyError,
    );
  });

  it("throws ProjectNotFoundError when the directory has no package.json and no React subprojects", async () => {
    const emptyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rdc-empty-"));
    try {
      await expect(diagnose(emptyDirectory, { lint: false })).rejects.toThrow(ProjectNotFoundError);
    } finally {
      fs.rmSync(emptyDirectory, { recursive: true, force: true });
    }
  });

  it("elapsedMilliseconds is non-negative", async () => {
    const result = await diagnose(path.join(FIXTURES_DIRECTORY, "basic-react"), {
      deadCode: false,
      lint: false,
    });
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it("resolves config plugins from the config source directory after rootDir redirect", async () => {
    clearConfigCache();
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rdc-rootdir-plugin-"));
    try {
      const webProjectDirectory = path.join(tempDirectory, "apps", "web");
      writeJson(path.join(webProjectDirectory, "package.json"), {
        name: "web",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      });
      writeJson(path.join(webProjectDirectory, "tsconfig.json"), {
        compilerOptions: { jsx: "preserve", strict: false, target: "es2022", module: "esnext" },
      });
      fs.mkdirSync(path.join(webProjectDirectory, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(webProjectDirectory, "src/App.tsx"),
        `export const App = () => <div>FORBIDDEN content</div>;\n`,
      );
      fs.mkdirSync(path.join(tempDirectory, "lint"), { recursive: true });
      fs.writeFileSync(path.join(tempDirectory, "lint/team-conventions.cjs"), forbiddenWordPlugin);
      writeJson(path.join(tempDirectory, "react-doctor.config.json"), {
        rootDir: "apps/web",
        plugins: ["./lint/team-conventions.cjs"],
        rules: { "team-conventions/no-forbidden-word": "error" },
      });

      const result = await diagnose(tempDirectory, { deadCode: false });

      expect(result.project.rootDirectory).toBe(webProjectDirectory);
      expect(result.diagnostics.some((diagnostic) => diagnostic.rule === "no-forbidden-word")).toBe(
        true,
      );
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
