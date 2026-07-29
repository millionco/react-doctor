import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { evaluateProject, evaluateSource, evaluateVirtualProject } from "./evaluate-source.js";
import { createRealFilesystemResourceHost } from "./resource-host/real-resource-host.js";

const PROJECT_FILES = new Map<string, string>([
  [
    "src/component.tsx",
    `import { useReducer } from "react";
import { counterReducer } from "./counter-reducer";

export const Component = () => {
  const [state] = useReducer(counterReducer, { count: 0 });
  return <output>{state.count}</output>;
};`,
  ],
  [
    "src/counter-reducer.ts",
    `export const counterReducer = (state: { count: number }) => {
  state.count += 1;
  return state;
};`,
  ],
]);

const temporaryDirectories: string[] = [];

const writeProjectFiles = (
  rootDirectory: string,
  projectFiles: ReadonlyMap<string, string> = PROJECT_FILES,
): void => {
  for (const [filename, sourceText] of projectFiles) {
    const absoluteFilename = path.join(rootDirectory, filename);
    fs.mkdirSync(path.dirname(absoluteFilename), { recursive: true });
    fs.writeFileSync(absoluteFilename, sourceText, "utf8");
  }
};

describe("project evaluator", () => {
  afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps real and in-memory cross-file rule execution exactly aligned", () => {
    const temporaryRootDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-evaluate-project-"),
    );
    temporaryDirectories.push(temporaryRootDirectory);
    writeProjectFiles(temporaryRootDirectory);

    const realResult = evaluateProject({
      files: PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: temporaryRootDirectory,
      }),
      ruleIds: ["no-mutating-reducer-state"],
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-project",
      files: PROJECT_FILES,
      ruleIds: ["no-mutating-reducer-state"],
    });

    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toEqual([]);
    expect(virtualResult.diagnostics).toHaveLength(1);
    expect(virtualResult.diagnostics[0]).toMatchObject({
      filePath: "src/component.tsx",
      rule: "no-mutating-reducer-state",
      message:
        "This reducer changes state in place, so your update is silently skipped. (mutation in imported reducer at `./counter-reducer`)",
    });
  });

  it("keeps barrel exports and ancestor metadata exactly aligned", () => {
    const projectFiles = new Map<string, string>([
      [
        "app/page.tsx",
        `import { PrimaryButton } from "../components";

export default function Page() {
  return <PrimaryButton />;
}`,
      ],
      [
        "app/covered/page.tsx",
        `export default function CoveredPage() {
  return <main>Covered</main>;
}`,
      ],
      [
        "app/covered/layout.mjs",
        `export const metadata = { title: "Covered", description: "Covered page" };`,
      ],
      [
        "app/non-metadata/page.tsx",
        `export default function UncoveredPage() {
  return <main>Uncovered</main>;
}`,
      ],
      ["app/non-metadata/layout.tsx", `export const viewport = { width: "device-width" };`],
      [
        "app/plain.tsx",
        `import { value } from "../components/not-a-barrel";

export const Plain = () => <output>{value}</output>;`,
      ],
      [
        "components/index.ts",
        `export { Button as PrimaryButton } from "./button.tsx";
export * from "./card.mjs";`,
      ],
      ["components/button.tsx", `export const Button = () => <button type="button" />;`],
      ["components/card.mjs", `export const Card = () => null;`],
      [
        "components/not-a-barrel/index.ts",
        `export const value = 1;
console.log(value);`,
      ],
      ["src/invalid.ts", "export const ="],
    ]);
    const temporaryRootDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-evaluate-export-project-"),
    );
    temporaryDirectories.push(temporaryRootDirectory);
    writeProjectFiles(temporaryRootDirectory, projectFiles);

    const realResult = evaluateProject({
      files: projectFiles,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: temporaryRootDirectory,
      }),
      ruleIds: ["nextjs-missing-metadata", "no-barrel-import"],
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-export-project",
      files: projectFiles,
      ruleIds: ["nextjs-missing-metadata", "no-barrel-import"],
    });

    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toHaveLength(1);
    expect(virtualResult.failures[0]).toMatchObject({
      kind: "parse",
      filePath: "src/invalid.ts",
    });
    expect(
      virtualResult.diagnostics.map(({ filePath, rule, message }) => ({
        filePath,
        rule,
        message,
      })),
    ).toEqual([
      {
        filePath: "app/page.tsx",
        rule: "nextjs-missing-metadata",
        message:
          "This page has no metadata, so search engines and social previews get no title or description.",
      },
      {
        filePath: "app/page.tsx",
        rule: "no-barrel-import",
        message:
          'This ships extra code to your users & slows page load. Import directly from "../components/button".',
      },
      {
        filePath: "app/non-metadata/page.tsx",
        rule: "nextjs-missing-metadata",
        message:
          "This page has no metadata, so search engines and social previews get no title or description.",
      },
    ]);
  });

  it("uses explicit package dependencies without package.json resources", () => {
    const files = new Map([
      [
        "src/checkbox.tsx",
        `export const Checkbox = () => <input type="checkbox" indeterminate />;`,
      ],
    ]);
    const reactNativeResult = evaluateVirtualProject({
      rootDirectory: "/virtual-native-project",
      files,
      packages: [
        {
          directoryPath: ".",
          manifest: {
            name: "native-project",
            dependencies: { "react-native": "0.80.0" },
          },
          installedDependencyVersions: { "react-native": "0.80.0" },
        },
      ],
      ruleIds: ["no-indeterminate-attribute"],
    });
    const webResult = evaluateVirtualProject({
      rootDirectory: "/virtual-web-project",
      files,
      packages: [
        {
          directoryPath: ".",
          manifest: {
            name: "web-project",
            dependencies: { "react-dom": "19.1.0" },
          },
          installedDependencyVersions: { "react-dom": "19.1.0" },
        },
      ],
      ruleIds: ["no-indeterminate-attribute"],
    });

    expect(reactNativeResult).toEqual({ diagnostics: [], failures: [] });
    expect(webResult.failures).toEqual([]);
    expect(webResult.diagnostics).toHaveLength(1);
    expect(webResult.diagnostics[0]?.rule).toBe("no-indeterminate-attribute");
  });

  it("keeps source-text-dependent rules aligned across real and virtual projects", () => {
    const sourceDependentProjectFiles = new Map<string, string>([
      [
        "src/dependencies.tsx",
        `import { useEffect } from "react";

export const SuppressedDependencies = ({ value }: { value: string }) => {
  useEffect(() => {
    console.log(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

export const ReportedDependencies = ({ value }: { value: string }) => {
  useEffect(() => {
    console.log(value);
  }, []);
  return null;
};`,
      ],
      [
        "src/hooks.tsx",
        `import { useEffect } from "react";

export const SuppressedHook = ({ enabled }: { enabled: boolean }) => {
  if (enabled) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => undefined, []);
  }
  return null;
};

export const ReportedHook = ({ enabled }: { enabled: boolean }) => {
  if (enabled) {
    useEffect(() => undefined, []);
  }
  return null;
};`,
      ],
      [
        "src/loaders.ts",
        `export const loadIgnored = (modulePath: string) =>
  import(/* @vite-ignore */ modulePath);
export const loadReported = (modulePath: string) => import(modulePath);`,
      ],
    ]);
    const temporaryRootDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-evaluate-source-dependent-project-"),
    );
    temporaryDirectories.push(temporaryRootDirectory);
    writeProjectFiles(temporaryRootDirectory, sourceDependentProjectFiles);

    const realResult = evaluateProject({
      files: sourceDependentProjectFiles,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: temporaryRootDirectory,
      }),
      ruleIds: ["exhaustive-deps", "rules-of-hooks", "no-dynamic-import-path"],
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-source-dependent-project",
      files: sourceDependentProjectFiles,
      ruleIds: ["exhaustive-deps", "rules-of-hooks", "no-dynamic-import-path"],
    });

    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toEqual([]);
    expect(virtualResult.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "exhaustive-deps",
      "rules-of-hooks",
      "no-dynamic-import-path",
    ]);
  });

  it("keeps audited cross-file evaluation unsupported without a project host", () => {
    expect(
      evaluateSource({
        sourceText: "export const Component = () => <View>Raw text</View>;",
        filename: "src/component.tsx",
        ruleIds: [
          "no-full-lodash-import",
          "no-hydration-branch-on-browser-global",
          "no-match-media-in-state-initializer",
          "no-unguarded-browser-global-in-render-or-hook-init",
          "rendering-hydration-mismatch-time",
          "rn-no-legacy-shadow-styles",
          "rn-no-raw-text",
          "rn-prefer-expo-image",
          "rn-style-prefer-boxshadow",
          "window-open-without-noopener",
        ],
      }),
    ).toEqual({
      diagnostics: [],
      failures: [
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "no-full-lodash-import",
          message: "Rule requires a project host: no-full-lodash-import",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "no-hydration-branch-on-browser-global",
          message: "Rule requires a project host: no-hydration-branch-on-browser-global",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "no-match-media-in-state-initializer",
          message: "Rule requires a project host: no-match-media-in-state-initializer",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "no-unguarded-browser-global-in-render-or-hook-init",
          message:
            "Rule requires a project host: no-unguarded-browser-global-in-render-or-hook-init",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "rendering-hydration-mismatch-time",
          message: "Rule requires a project host: rendering-hydration-mismatch-time",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "rn-no-legacy-shadow-styles",
          message: "Rule requires a project host: rn-no-legacy-shadow-styles",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "rn-no-raw-text",
          message: "Rule requires a project host: rn-no-raw-text",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "rn-prefer-expo-image",
          message: "Rule requires a project host: rn-prefer-expo-image",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "rn-style-prefer-boxshadow",
          message: "Rule requires a project host: rn-style-prefer-boxshadow",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: "window-open-without-noopener",
          message: "Rule requires a project host: window-open-without-noopener",
        },
      ],
    });
  });
});
