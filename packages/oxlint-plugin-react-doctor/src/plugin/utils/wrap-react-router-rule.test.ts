import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import type { Rule } from "./rule.js";
import { wrapReactRouterRule } from "./wrap-react-router-rule.js";

const probeRule: Rule = {
  id: "react-router-gate-probe",
  severity: "warn",
  create: (context) => ({
    Program(node) {
      context.report({ node, message: "probe fired" });
    },
  }),
};

const wrappedProbe = wrapReactRouterRule(probeRule);
const wrappedFrameworkProbe = wrapReactRouterRule({
  ...probeRule,
  requires: ["react-router-framework"],
});

describe("wrap-react-router-rule", () => {
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-react-router-gate-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const createPackageFilename = (manifest: Record<string, unknown>): string => {
    const packageDirectory = fs.mkdtempSync(path.join(temporaryDirectory, "package-"));
    fs.writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify(manifest));
    return path.join(packageDirectory, "src", "route.tsx");
  };

  const createRootPackageFilename = (manifest: Record<string, unknown>): string => {
    fs.writeFileSync(path.join(temporaryDirectory, "package.json"), JSON.stringify(manifest));
    return path.join(temporaryDirectory, "src", "route.tsx");
  };

  const rootDirectorySettings = () => ({
    "react-doctor": { rootDirectory: fs.realpathSync(temporaryDirectory) },
  });

  it.each(["react-router", "react-router-dom", "@react-router/dev"])(
    "fires in a package declaring %s",
    (packageName) => {
      const result = runRule(wrappedProbe, "export {};", {
        filename: createPackageFilename({ dependencies: { [packageName]: "7.9.0" } }),
        settings: rootDirectorySettings(),
      });
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("stays silent in a nested workspace package without React Router", () => {
    const result = runRule(wrappedProbe, "export {};", {
      filename: createPackageFilename({ dependencies: { react: "19.0.0", vite: "7.0.0" } }),
      settings: rootDirectorySettings(),
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for Framework rules in a Data mode sibling package", () => {
    const result = runRule(wrappedFrameworkProbe, "export {};", {
      filename: createPackageFilename({ dependencies: { "react-router": "7.9.0" } }),
      settings: {
        "react-doctor": {
          capabilities: ["react-router:7.9", "react-router-framework"],
          rootDirectory: fs.realpathSync(temporaryDirectory),
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for Framework rules in a Data mode root package", () => {
    const result = runRule(wrappedFrameworkProbe, "export {};", {
      filename: createRootPackageFilename({ dependencies: { "react-router": "7.9.0" } }),
      settings: {
        "react-doctor": {
          capabilities: ["react-router:7.9", "react-router-framework"],
          rootDirectory: fs.realpathSync(temporaryDirectory),
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("fires Framework rules in a package declaring the Framework dev dependency", () => {
    const result = runRule(wrappedFrameworkProbe, "export {};", {
      filename: createPackageFilename({
        dependencies: { "@react-router/dev": "7.9.0", "react-router": "7.9.0" },
      }),
      settings: {
        "react-doctor": {
          capabilities: ["react-router:7.9", "react-router-framework"],
          rootDirectory: fs.realpathSync(temporaryDirectory),
        },
      },
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps the project-level decision when no filename is available", () => {
    const result = runRule(wrappedProbe, "export {};", { filename: undefined });
    expect(result.diagnostics).toHaveLength(1);
  });
});
