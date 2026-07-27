import { describe, expect, it } from "vite-plus/test";
import type { Rule } from "./rule.js";
import type { RulePackageContext } from "./rule-package-context.js";
import { wrapWithSemanticContext } from "./wrap-with-semantic-context.js";

const packageContexts = [
  {
    relativeDirectory: "packages/legacy",
    capabilities: ["vite", "react", "react:17", "react:18"],
    dependencies: [
      {
        name: "react",
        section: "dependencies",
        rawSpecifier: "^18.2.0",
        resolvedSpecifier: "^18.2.0",
      },
    ],
  },
  {
    relativeDirectory: "packages/modern",
    capabilities: ["nextjs", "nextjs:15", "react", "react:17", "react:18", "react:19"],
    dependencies: [
      {
        name: "next",
        section: "dependencies",
        rawSpecifier: "^15.0.0",
        resolvedSpecifier: "^15.0.0",
      },
      {
        name: "react",
        section: "dependencies",
        rawSpecifier: "^19.0.0",
        resolvedSpecifier: "^19.0.0",
      },
    ],
  },
];

const buildSettings = (packageCapabilityGates: boolean) => ({
  "react-doctor": {
    rootDirectory: "/workspace",
    capabilities: ["vite", "react", "react:17", "react:18"],
    packageContexts,
    packageContextEnabled: true,
    ...(packageCapabilityGates ? { packageCapabilityGates: true } : {}),
  },
});

const didCreateRule = (
  rule: Rule,
  filename: string,
  settings: Readonly<Record<string, unknown>>,
): boolean => {
  let didCreate = false;
  wrapWithSemanticContext({
    ...rule,
    create: (context) => {
      didCreate = true;
      return rule.create(context);
    },
  }).create({
    report: () => {},
    filename,
    settings,
  });
  return didCreate;
};

describe("package-aware rule context", () => {
  it("resolves exact owning-package dependencies without enabling per-file gates", () => {
    let packageContext: RulePackageContext | null | undefined;
    const probeRule: Rule = {
      id: "package-context-probe",
      severity: "warn",
      create: (context) => {
        packageContext = context.packageContext;
        return {};
      },
    };

    wrapWithSemanticContext(probeRule).create({
      report: () => {},
      filename: "/workspace/packages/modern/src/app.tsx",
      settings: buildSettings(false),
    });

    expect(packageContext?.relativeDirectory).toBe("packages/modern");
    expect(packageContext?.hasDependency("next")).toBe(true);
    expect(packageContext?.getDependency("react")).toEqual({
      name: "react",
      section: "dependencies",
      rawSpecifier: "^19.0.0",
      resolvedSpecifier: "^19.0.0",
    });
    expect(packageContext?.hasCapability("react:19")).toBe(true);
  });

  it("keeps legacy activation exact when the opt-in setting is absent", () => {
    const rule: Rule = {
      id: "requires-react-19",
      severity: "warn",
      requires: ["react:19"],
      create: () => ({}),
    };

    expect(
      didCreateRule(rule, "/workspace/packages/legacy/src/app.tsx", buildSettings(false)),
    ).toBe(true);
  });

  it("gates required and disabled capabilities by the owning package when opted in", () => {
    const requiresReact19: Rule = {
      id: "requires-react-19",
      severity: "warn",
      requires: ["react:19"],
      create: () => ({}),
    };
    const disabledForNext: Rule = {
      id: "disabled-for-next",
      severity: "warn",
      disabledWhen: ["nextjs"],
      create: () => ({}),
    };
    const settings = buildSettings(true);

    expect(didCreateRule(requiresReact19, "/workspace/packages/legacy/src/app.tsx", settings)).toBe(
      false,
    );
    expect(didCreateRule(requiresReact19, "/workspace/packages/modern/src/app.tsx", settings)).toBe(
      true,
    );
    expect(didCreateRule(disabledForNext, "/workspace/packages/legacy/src/app.tsx", settings)).toBe(
      true,
    );
    expect(didCreateRule(disabledForNext, "/workspace/packages/modern/src/app.tsx", settings)).toBe(
      false,
    );
  });

  it("preserves project-level capabilities that are not package-derived", () => {
    const rule: Rule = {
      id: "compiler-disabled",
      severity: "warn",
      disabledWhen: ["react-compiler"],
      create: () => ({}),
    };
    const settings = buildSettings(true);
    settings["react-doctor"].capabilities.push("react-compiler");

    expect(didCreateRule(rule, "/workspace/packages/modern/src/app.tsx", settings)).toBe(false);
  });

  it("falls back to project capabilities when no owning package is available", () => {
    const rule: Rule = {
      id: "requires-react-18",
      severity: "warn",
      requires: ["react:18"],
      create: () => ({}),
    };

    expect(didCreateRule(rule, "/outside/file.tsx", buildSettings(true))).toBe(true);
  });
});
