import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { onlyExportComponents } from "./only-export-components.js";

interface ProjectFixture {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  manifestFields?: Record<string, unknown>;
  config?: string;
  configFilename?: string;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  resetManifestCaches();
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const createProject = ({
  dependencies = { react: "19.0.0" },
  devDependencies,
  manifestFields,
  config,
  configFilename = "vite.config.ts",
}: ProjectFixture): string => {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-refresh-"));
  temporaryDirectories.push(projectDirectory);
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({
      name: "refresh-fixture",
      dependencies,
      devDependencies,
      ...(config && configFilename.startsWith("vite.config") ? { scripts: { dev: "vite" } } : {}),
      ...manifestFields,
    }),
  );
  if (config) fs.writeFileSync(path.join(projectDirectory, configFilename), config);
  fs.mkdirSync(path.join(projectDirectory, "src", "components", "card"), { recursive: true });
  return projectDirectory;
};

const runMixedExportRule = (projectDirectory: string, relativeFilename = "src/card.tsx") =>
  runRule(
    onlyExportComponents,
    `export const Card = () => <div />; export const cardLabel = getLabel();`,
    { filename: path.join(projectDirectory, relativeFilename) },
  );

describe("only-export-components Fast Refresh applicability", () => {
  it.each([
    ["plain webpack", { devDependencies: { webpack: "5.0.0", "ts-loader": "9.0.0" } }],
    ["plain Vite", { devDependencies: { vite: "7.0.0" } }],
    ["react-refresh runtime alone", { devDependencies: { "react-refresh": "0.18.0" } }],
    [
      "unregistered Vite React dependency",
      { devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" } },
    ],
    [
      "imported but unused Vite React plugin",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import react from "@vitejs/plugin-react"; export default { plugins: [] };`,
      },
    ],
    [
      "plugin call outside the config plugins list",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import react from "@vitejs/plugin-react"; const example = react(); export default { plugins: [] };`,
      },
    ],
    [
      "unexported plugins object",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import react from "@vitejs/plugin-react"; const unused = { plugins: [react()] }; export default { plugins: [] };`,
      },
    ],
    [
      "nested Babel plugins object",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import react from "@vitejs/plugin-react"; export default { babel: { plugins: [react()] }, plugins: [] };`,
      },
    ],
    [
      "commented plugin registration",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import react from "@vitejs/plugin-react"; export default { plugins: [/* react() */] };`,
      },
    ],
  ] as const)("stays silent without transform proof — %s", (_label, fixture) => {
    const result = runMixedExportRule(createProject(fixture));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "Vite React",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import react from "@vitejs/plugin-react"; export default { plugins: [react()] };`,
      },
    ],
    [
      "Vite React SWC alias",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react-swc": "4.0.0" },
        config: `import refreshTransform from "@vitejs/plugin-react-swc"; export default { plugins: [refreshTransform()] };`,
      },
    ],
    [
      "Vite React re-exported default",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import { default as enableReact } from "@vitejs/plugin-react"; export default { plugins: [enableReact()] };`,
      },
    ],
    [
      "webpack React Refresh",
      {
        devDependencies: {
          webpack: "5.0.0",
          "@pmmmwh/react-refresh-webpack-plugin": "0.6.0",
        },
        configFilename: "webpack.config.js",
        config: `import ReactRefreshPlugin from "@pmmmwh/react-refresh-webpack-plugin"; export default { plugins: [new ReactRefreshPlugin()] };`,
      },
    ],
    [
      "CommonJS webpack React Refresh",
      {
        devDependencies: {
          webpack: "5.0.0",
          "@pmmmwh/react-refresh-webpack-plugin": "0.6.0",
        },
        configFilename: "webpack.config.cjs",
        config: `const ReactRefreshPlugin = require("@pmmmwh/react-refresh-webpack-plugin"); module.exports = { plugins: [new ReactRefreshPlugin()] };`,
      },
    ],
    [
      "Rsbuild React",
      {
        devDependencies: { "@rsbuild/core": "1.0.0", "@rsbuild/plugin-react": "1.0.0" },
        configFilename: "rsbuild.config.ts",
        config: `import { pluginReact as enableReact } from "@rsbuild/plugin-react"; export default { plugins: [enableReact()] };`,
      },
    ],
    [
      "exported config and plugin bindings",
      {
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import react from "@vitejs/plugin-react"; const plugins = [react()]; const config = { plugins }; export default config;`,
      },
    ],
  ] as const)("reports with registered transform proof — %s", (_label, fixture) => {
    const result = runMixedExportRule(createProject(fixture));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["Next.js", { next: "9.4.0", react: "16.13.0" }],
    ["Create React App", { "react-scripts": "4.0.0", react: "17.0.0" }],
    ["Gatsby", { gatsby: "2.31.0", react: "17.0.0" }],
    ["Expo", { expo: "36.0.0", react: "16.9.0" }],
    ["React Native", { "react-native": "0.61.0", react: "16.9.0" }],
  ] as const)("reports for a built-in transform — %s", (_label, dependencies) => {
    expect(runMixedExportRule(createProject({ dependencies })).diagnostics).toHaveLength(1);
  });

  it("reports same-named ordinary components in a Next.js project", () => {
    const projectDirectory = createProject({ dependencies: { next: "16.0.0", react: "19.0.0" } });
    expect(
      runMixedExportRule(projectDirectory, "src/components/layout.tsx").diagnostics,
    ).toHaveLength(1);
  });

  it("keeps actual Next.js route modules exempt", () => {
    const projectDirectory = createProject({ dependencies: { next: "16.0.0", react: "19.0.0" } });
    expect(
      runMixedExportRule(projectDirectory, "app/dashboard/layout.tsx").diagnostics,
    ).toHaveLength(0);
  });

  it.each(["src/components/_layout.tsx", "src/components/+not-found.tsx"])(
    "reports Expo reserved basenames outside the route root — %s",
    (relativeFilename) => {
      const projectDirectory = createProject({
        dependencies: { expo: "55.0.0", "expo-router": "55.0.0", react: "19.0.0" },
      });
      expect(runMixedExportRule(projectDirectory, relativeFilename).diagnostics).toHaveLength(1);
    },
  );

  it.each(["app/_layout.tsx", "src/app/(tabs)/+not-found.tsx"])(
    "keeps actual Expo Router special modules exempt — %s",
    (relativeFilename) => {
      const projectDirectory = createProject({
        dependencies: { expo: "55.0.0", "expo-router": "55.0.0", react: "19.0.0" },
      });
      expect(runMixedExportRule(projectDirectory, relativeFilename).diagnostics).toHaveLength(0);
    },
  );

  it("reports for a Parcel browser entry", () => {
    expect(
      runMixedExportRule(
        createProject({
          dependencies: { react: "18.0.0" },
          devDependencies: { parcel: "2.0.0" },
          manifestFields: { scripts: { start: "parcel src/index.html" } },
        }),
      ).diagnostics,
    ).toHaveLength(1);
  });

  it("reports for a Parcel serve command with a manifest browser entry", () => {
    expect(
      runMixedExportRule(
        createProject({
          dependencies: { react: "18.0.0" },
          devDependencies: { parcel: "2.0.0" },
          manifestFields: {
            source: "src/index.html",
            scripts: { start: "parcel serve" },
          },
        }),
      ).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    "parcel build src/index.html",
    "parcel watch src/index.html",
    "parcel help",
    "parcel --help",
    "parcel --version",
    "parcel -h",
    "parcel -V",
    "parcel src/index.html --no-hmr",
  ])("stays silent for a non-serving Parcel command — %s", (parcelCommand) => {
    expect(
      runMixedExportRule(
        createProject({
          dependencies: { react: "18.0.0" },
          devDependencies: { parcel: "2.0.0" },
          manifestFields: {
            source: "src/index.html",
            scripts: { build: parcelCommand },
          },
        }),
      ).diagnostics,
    ).toHaveLength(0);
  });

  it("reports for development tooling with an owned app command", () => {
    expect(
      runMixedExportRule(
        createProject({
          dependencies: { react: "19.0.0" },
          devDependencies: { next: "16.0.0" },
          manifestFields: { scripts: { dev: "cross-env NODE_ENV=development next dev" } },
        }),
      ).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    ["Next.js", { next: "9.3.9", react: "16.13.0" }],
    ["Create React App", { "react-scripts": "3.4.4", react: "16.13.0" }],
    ["Gatsby", { gatsby: "2.30.0", react: "17.0.0" }],
    ["Gatsby 2 with React 16", { gatsby: "2.31.0", react: "16.14.0" }],
    ["Parcel", { parcel: "1.12.5", react: "17.0.0" }],
    ["Expo", { expo: "35.0.0", react: "16.8.0" }],
    ["React Native", { "react-native": "0.60.6", react: "16.8.0" }],
  ] as const)("stays silent before built-in Fast Refresh — %s", (_label, dependencies) => {
    expect(runMixedExportRule(createProject({ dependencies })).diagnostics).toHaveLength(0);
  });

  it.each([
    ["react-scripts used only for tests", { "react-scripts": "4.0.0" }],
    ["Next used only as development tooling", { next: "16.0.0" }],
    ["Parcel library entry", { parcel: "2.0.0" }],
  ])("stays silent for an unowned development dependency — %s", (_label, devDependencies) => {
    expect(
      runMixedExportRule(createProject({ dependencies: { react: "19.0.0" }, devDependencies }))
        .diagnostics,
    ).toHaveLength(0);
  });

  it("uses the nearest package boundary instead of a sibling or parent integration", () => {
    const projectDirectory = createProject({
      devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
      config: `import react from "@vitejs/plugin-react"; export default { plugins: [react()] };`,
    });
    const fixtureDirectory = path.join(projectDirectory, "fixtures", "plain-webpack");
    fs.mkdirSync(path.join(fixtureDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(fixtureDirectory, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0" }, devDependencies: { webpack: "5.0.0" } }),
    );

    expect(runMixedExportRule(projectDirectory).diagnostics).toHaveLength(1);
    expect(runMixedExportRule(fixtureDirectory).diagnostics).toHaveLength(0);
  });

  it("scopes route export contracts to the registered framework integration", () => {
    const reactRouterProject = createProject({
      dependencies: { react: "19.0.0", "@react-router/dev": "7.0.0" },
      devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
      config: `
        import react from "@vitejs/plugin-react";
        import { reactRouter as routes } from "@react-router/dev/vite";
        export default { plugins: [react(), routes()] };
      `,
    });
    const genericViteProject = createProject({
      devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
      config: `import react from "@vitejs/plugin-react"; export default { plugins: [react()] };`,
    });
    const routeModule = `export const loader = () => getData(); export default function Route() { return <div />; }`;

    expect(
      runRule(onlyExportComponents, routeModule, {
        filename: path.join(reactRouterProject, "app", "routes", "profile.tsx"),
      }).diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(onlyExportComponents, routeModule, {
        filename: path.join(genericViteProject, "src", "profile.tsx"),
      }).diagnostics,
    ).toHaveLength(1);
  });

  it("scopes Nextra metadata filenames to Next.js", () => {
    const nextProject = createProject({
      dependencies: { react: "19.0.0", next: "16.0.0" },
    });
    const genericViteProject = createProject({
      devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
      config: `import react from "@vitejs/plugin-react"; export default { plugins: [react()] };`,
    });
    const metadataModule = `export default () => <div />;`;

    expect(
      runRule(onlyExportComponents, metadataModule, {
        filename: path.join(nextProject, "pages", "docs", "_meta.tsx"),
      }).diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(onlyExportComponents, metadataModule, {
        filename: path.join(genericViteProject, "src", "_meta.tsx"),
      }).diagnostics,
    ).toHaveLength(1);
  });

  it.each(["src/components/card/index.tsx", "src/App.tsx", "examples/demo-card.tsx"])(
    "checks a transformed module independent of filename — %s",
    (relativeFilename) => {
      const projectDirectory = createProject({
        devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        config: `import react from "@vitejs/plugin-react"; export default { plugins: [react()] };`,
      });
      expect(runMixedExportRule(projectDirectory, relativeFilename).diagnostics).toHaveLength(1);
    },
  );

  it.each(["src/testUtils.tsx", "src/test-helpers.tsx", "src/specSetup.jsx"])(
    "stays silent for a test support module — %s",
    (relativeFilename) => {
      const projectDirectory = createProject({
        dependencies: { react: "19.0.0", "react-scripts": "5.0.1" },
      });
      expect(runMixedExportRule(projectDirectory, relativeFilename).diagnostics).toHaveLength(0);
    },
  );

  it("stays silent for a pure star-export barrel", () => {
    const projectDirectory = createProject({
      dependencies: { react: "19.0.0", "react-scripts": "5.0.1" },
    });
    const result = runRule(onlyExportComponents, `export * from "./button";`, {
      filename: path.join(projectDirectory, "src", "components", "index.tsx"),
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a star export beside a local component export", () => {
    const projectDirectory = createProject({
      dependencies: { react: "19.0.0", "react-scripts": "5.0.1" },
    });
    const result = runRule(
      onlyExportComponents,
      `export * from "./button"; export const Card = () => <div />;`,
      { filename: path.join(projectDirectory, "src", "components", "index.tsx") },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a star export adds only types and a default export", () => {
    const projectDirectory = createProject({
      dependencies: { react: "19.0.0", "react-scripts": "5.0.1" },
    });
    fs.writeFileSync(
      path.join(projectDirectory, "src", "components", "button.tsx"),
      `export interface ButtonProps { label: string } export default () => <button />;`,
    );
    const result = runRule(
      onlyExportComponents,
      `export * from "./button"; export const Card = () => <div />;`,
      { filename: path.join(projectDirectory, "src", "components", "index.tsx") },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports when a star export adds a runtime named value", () => {
    const projectDirectory = createProject({
      dependencies: { react: "19.0.0", "react-scripts": "5.0.1" },
    });
    fs.writeFileSync(
      path.join(projectDirectory, "src", "components", "button.tsx"),
      `export const buttonLabel = "Button"; export default () => <button />;`,
    );
    const result = runRule(
      onlyExportComponents,
      `export * from "./button"; export const Card = () => <div />;`,
      { filename: path.join(projectDirectory, "src", "components", "index.tsx") },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "an inline type re-export and default",
      `interface ButtonProps { label: string } const Button = () => <button />; export { type ButtonProps, Button as default };`,
      0,
    ],
    ["a default re-export", `export { default } from "./leaf";`, 0],
    [
      "a default renamed to a runtime named export",
      `export { default as Button } from "./leaf";`,
      1,
    ],
    ["a runtime enum", `export enum ButtonSize { Small, Large }`, 1],
    ["a nested runtime star export", `export * from "./runtime-leaf";`, 1],
  ] as const)(
    "classifies a star target containing %s",
    (_label, targetSource, expectedDiagnosticCount) => {
      const projectDirectory = createProject({
        dependencies: { react: "19.0.0", "react-scripts": "5.0.1" },
      });
      fs.writeFileSync(
        path.join(projectDirectory, "src", "components", "button.tsx"),
        targetSource,
      );
      fs.writeFileSync(
        path.join(projectDirectory, "src", "components", "leaf.tsx"),
        `export default () => <button />;`,
      );
      fs.writeFileSync(
        path.join(projectDirectory, "src", "components", "runtime-leaf.tsx"),
        `export const buttonLabel = "Button";`,
      );
      const result = runRule(
        onlyExportComponents,
        `export * from "./button"; export const Card = () => <div />;`,
        { filename: path.join(projectDirectory, "src", "components", "index.tsx") },
      );
      expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
    },
  );
});
