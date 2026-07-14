import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { __clearParseSourceFileCacheForTests } from "./parse-source-file.js";
import { resetManifestCaches } from "./read-nearest-package-manifest.js";
import { probeFastRefreshFileStatus } from "./get-fast-refresh-file-status.js";

interface FastRefreshFixture {
  manifest: Record<string, unknown>;
  files?: Record<string, string>;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  resetManifestCaches();
  __clearParseSourceFileCacheForTests();
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const createFixture = ({ manifest, files = {} }: FastRefreshFixture): string => {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-fast-refresh-status-"));
  temporaryDirectories.push(projectDirectory);
  fs.writeFileSync(path.join(projectDirectory, "package.json"), JSON.stringify(manifest));
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
  }
  const sourcePath = path.join(projectDirectory, "src", "Card.tsx");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, "export const Card = () => <div />;\n");
  return sourcePath;
};

const createWorkspaceFixture = (files: Record<string, string>): string => {
  const workspaceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-refresh-workspace-"));
  temporaryDirectories.push(workspaceDirectory);
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(workspaceDirectory, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
  }
  return workspaceDirectory;
};

const viteManifest = (scripts: Record<string, string>): Record<string, unknown> => ({
  scripts,
  dependencies: { react: "19.0.0" },
  devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
});

describe("probeFastRefreshFileStatus", () => {
  it("resolves an existing relative filename against the current directory", () => {
    const sourcePath = createFixture({
      manifest: viteManifest({ dev: "vite" }),
      files: {
        "vite.config.ts":
          'import react from "@vitejs/plugin-react"; export default { plugins: [react()] };',
      },
    });

    expect(probeFastRefreshFileStatus(path.relative(process.cwd(), sourcePath)).isActive).toBe(
      true,
    );
  });

  it("rejects a Vite React plugin used only by a library build", () => {
    const sourcePath = createFixture({
      manifest: viteManifest({ build: "vite build" }),
      files: {
        "vite.config.ts":
          'import react from "@vitejs/plugin-react"; export default { plugins: [react()], build: { lib: { entry: "src/index.ts" } } };',
      },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(false);
  });

  it("follows an explicit development config path", () => {
    const sourcePath = createFixture({
      manifest: viteManifest({ dev: "vite --config dev/vite.config.ts" }),
      files: {
        "dev/vite.config.ts":
          'import react from "@vitejs/plugin-react"; export default { plugins: [react()] };',
      },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(true);
  });

  it("recognizes a quoted Vite command inside a concurrent development script", () => {
    const sourcePath = createFixture({
      manifest: viteManifest({
        dev: 'concurrently -n VITE,STYLES "vite --host 0.0.0.0" "pnpm watch:styles"',
      }),
      files: {
        "vite.config.ts":
          'import react from "@vitejs/plugin-react"; export default { plugins: [react()] };',
      },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(true);
  });

  it.each([
    [
      "generic before framework",
      `
        import react from "@vitejs/plugin-react";
        import { reactRouter } from "@react-router/dev/vite";
        export default { plugins: [react(), reactRouter()] };
      `,
      "react-router",
    ],
    [
      "framework before generic",
      `
        import react from "@vitejs/plugin-react";
        import { reactRouter } from "@react-router/dev/vite";
        export default { plugins: [reactRouter(), react()] };
      `,
      "react-router",
    ],
    [
      "multiple frameworks",
      `
        import react from "@vitejs/plugin-react";
        import { reactRouter } from "@react-router/dev/vite";
        import { vitePlugin } from "@remix-run/dev";
        export default { plugins: [react(), reactRouter(), vitePlugin()] };
      `,
      "remix",
    ],
    [
      "aliases around an unknown plugin",
      `
        import { default as enableReact } from "@vitejs/plugin-react";
        import { reactRouter as enableRoutes } from "@react-router/dev/vite";
        const makeUnknownPlugin = () => ({ name: "unknown" });
        const plugins = [enableReact(), makeUnknownPlugin(), enableRoutes()];
        export default { plugins };
      `,
      "react-router",
    ],
    [
      "unknown plugin with generic React",
      `
        import react from "@vitejs/plugin-react";
        const makeUnknownPlugin = () => ({ name: "unknown" });
        export default { plugins: [makeUnknownPlugin(), react()] };
      `,
      "generic",
    ],
  ])(
    "selects the registered runtime independent of plugin order — %s",
    (_label, config, runtime) => {
      const sourcePath = createFixture({
        manifest: {
          scripts: { dev: "vite" },
          dependencies: {
            react: "19.0.0",
            "@react-router/dev": "7.0.0",
            "@remix-run/dev": "2.17.0",
            "@tanstack/react-start": "1.120.0",
          },
          devDependencies: { vite: "7.0.0", "@vitejs/plugin-react": "5.0.0" },
        },
        files: { "vite.config.ts": config },
      });

      expect(probeFastRefreshFileStatus(sourcePath)).toEqual({ isActive: true, runtime });
    },
  );

  it("resolves an unreassigned function-local plugin array in the exported config factory", () => {
    const sourcePath = createFixture({
      manifest: viteManifest({ dev: "vite --host localhost" }),
      files: {
        "vite.config.ts": `
          import react from "@vitejs/plugin-react";
          export default async () => {
            const plugins = [react()];
            return { plugins };
          };
        `,
      },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(true);
  });

  it.each([
    [
      "reassigned plugin array",
      `
        import react from "@vitejs/plugin-react";
        export default () => {
          let plugins = [react()];
          plugins = [];
          return { plugins };
        };
      `,
    ],
    [
      "shadowed plugin array",
      `
        import react from "@vitejs/plugin-react";
        export default () => {
          const plugins = [react()];
          {
            const plugins = [];
            return { plugins };
          }
        };
      `,
    ],
    [
      "unused local config",
      `
        import react from "@vitejs/plugin-react";
        export default () => {
          const unused = { plugins: [react()] };
          return { plugins: [] };
        };
      `,
    ],
    [
      "nested helper return",
      `
        import react from "@vitejs/plugin-react";
        export default () => {
          const makeUnusedConfig = () => ({ plugins: [react()] });
          return { plugins: [] };
        };
      `,
    ],
    [
      "shadowed exported config name",
      `
        import react from "@vitejs/plugin-react";
        const config = { plugins: [react()] };
        export default () => {
          const config = { plugins: [] };
          return config;
        };
      `,
    ],
  ])("rejects an unproven config binding — %s", (_label, config) => {
    const sourcePath = createFixture({
      manifest: viteManifest({ dev: "vite" }),
      files: { "vite.config.ts": config },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(false);
  });

  it.each([
    ["inline CommonJS config", "module.exports = { reactOptions: { fastRefresh: true } };"],
    [
      "aliased TypeScript config",
      "const fastRefresh = true; const reactOptions = { fastRefresh }; const config = { reactOptions }; export default config;",
    ],
  ])("recognizes explicitly enabled Storybook Webpack Fast Refresh — %s", (_label, config) => {
    const sourcePath = createFixture({
      manifest: {
        scripts: { storybook: "start-storybook -p 6006" },
        dependencies: { react: "18.0.0" },
        devDependencies: { "@storybook/react": "6.5.14" },
      },
      files: { ".storybook/main.ts": config },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(true);
  });

  it.each([
    ["disabled", "module.exports = { reactOptions: { fastRefresh: false } };", "6.5.14"],
    [
      "overridden by a later property",
      "module.exports = { reactOptions: { fastRefresh: true, fastRefresh: false } };",
      "6.5.14",
    ],
    [
      "overridden by a later spread",
      "const overrides = {}; module.exports = { reactOptions: { fastRefresh: true, ...overrides } };",
      "6.5.14",
    ],
    [
      "unexported decoy",
      "const unused = { reactOptions: { fastRefresh: true } }; module.exports = { reactOptions: { fastRefresh: false } };",
      "6.5.14",
    ],
    [
      "reassigned alias",
      "let enabled = true; enabled = false; module.exports = { reactOptions: { fastRefresh: enabled } };",
      "6.5.14",
    ],
    ["string value", 'module.exports = { reactOptions: { fastRefresh: "true" } };', "6.5.14"],
    ["unsupported version", "module.exports = { reactOptions: { fastRefresh: true } };", "6.0.28"],
  ])("rejects unproven Storybook Webpack Fast Refresh — %s", (_label, config, storybookVersion) => {
    const sourcePath = createFixture({
      manifest: {
        scripts: { storybook: "start-storybook -p 6006" },
        dependencies: { react: "18.0.0" },
        devDependencies: { "@storybook/react": storybookVersion },
      },
      files: { ".storybook/main.js": config },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(false);
  });

  it("rejects an explicit Storybook Webpack option without an owned development command", () => {
    const sourcePath = createFixture({
      manifest: {
        scripts: { build: "build-storybook" },
        dependencies: { react: "18.0.0" },
        devDependencies: { "@storybook/react": "6.5.14" },
      },
      files: { ".storybook/main.js": "module.exports = { reactOptions: { fastRefresh: true } };" },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(false);
  });

  it("rejects Storybook Webpack when Fast Refresh is not explicitly enabled", () => {
    const sourcePath = createFixture({
      manifest: {
        scripts: { storybook: "start-storybook -p 6006" },
        dependencies: { react: "18.0.0" },
        devDependencies: {
          "@storybook/react": "6.5.14",
          "@pmmmwh/react-refresh-webpack-plugin": "0.5.11",
          "react-refresh": "0.14.0",
        },
      },
      files: { ".storybook/main.js": "module.exports = { stories: ['../src/**/*.stories.tsx'] };" },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(false);
  });

  it("recognizes the Rozenite wrapper only when its development config registers it", () => {
    const activeSourcePath = createFixture({
      manifest: {
        scripts: { dev: "rozenite dev" },
        dependencies: { react: "19.0.0" },
        devDependencies: { vite: "7.0.0", "@rozenite/vite-plugin": "1.9.0" },
      },
      files: {
        "vite.config.ts":
          'import { rozenitePlugin } from "@rozenite/vite-plugin"; export default { plugins: [rozenitePlugin()] };',
        "index.html": '<main id="root"></main>',
      },
    });
    const inactiveSourcePath = createFixture({
      manifest: {
        scripts: { dev: "rozenite dev" },
        dependencies: { react: "19.0.0" },
        devDependencies: { vite: "7.0.0", "@rozenite/vite-plugin": "1.9.0" },
      },
      files: {
        "vite.config.ts":
          'import { rozenitePlugin } from "@rozenite/vite-plugin"; export default { plugins: [] };',
        "index.html": '<main id="root"></main>',
      },
    });

    expect(probeFastRefreshFileStatus(activeSourcePath).isActive).toBe(true);
    expect(probeFastRefreshFileStatus(inactiveSourcePath).isActive).toBe(false);
  });

  it("recognizes an explicitly configured React Vite Storybook", () => {
    const sourcePath = createFixture({
      manifest: {
        scripts: { storybook: "storybook dev -p 6006" },
        dependencies: { react: "19.0.0" },
        devDependencies: { "@storybook/react-vite": "9.0.0" },
      },
      files: {
        ".storybook/main.js":
          'export default { framework: { name: "@storybook/react-vite", options: {} } };',
      },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(true);
  });

  it.each([
    ["non-Vite framework", 'export default { framework: "@storybook/react-webpack5" };'],
    [
      "unexported framework",
      'const unused = { framework: "@storybook/react-vite" }; export default { framework: "@storybook/react-webpack5" };',
    ],
  ])("rejects Storybook without exported React Vite proof — %s", (_label, config) => {
    const sourcePath = createFixture({
      manifest: {
        scripts: { storybook: "storybook dev -p 6006" },
        dependencies: { react: "19.0.0" },
        devDependencies: { "@storybook/react-vite": "9.0.0" },
      },
      files: { ".storybook/main.js": config },
    });

    expect(probeFastRefreshFileStatus(sourcePath).isActive).toBe(false);
  });

  it("recognizes Dumi only when the owning package runs a Fast Refresh default version", () => {
    const activeSourcePath = createFixture({
      manifest: {
        scripts: { dev: "dumi dev" },
        dependencies: { react: "18.0.0" },
        devDependencies: { dumi: "2.4.23" },
      },
    });
    const inactiveSourcePath = createFixture({
      manifest: {
        scripts: { test: "dumi dev" },
        dependencies: { react: "18.0.0" },
        devDependencies: { dumi: "1.1.53" },
      },
    });

    expect(probeFastRefreshFileStatus(activeSourcePath).isActive).toBe(true);
    expect(probeFastRefreshFileStatus(inactiveSourcePath).isActive).toBe(false);
  });

  it("inherits Fast Refresh through an active consumer's literal Vite alias", () => {
    const workspaceDirectory = createWorkspaceFixture({
      "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"] }),
      "apps/web/package.json": JSON.stringify(viteManifest({ dev: "vite" })),
      "apps/web/vite.config.ts": `
        import react from "@vitejs/plugin-react";
        import path from "node:path";
        export default {
          plugins: [react()],
          resolve: { alias: { ui: path.resolve(__dirname, "../../packages/ui/src") } },
        };
      `,
      "packages/ui/package.json": JSON.stringify({ name: "ui" }),
      "packages/ui/src/Card.tsx": "export const Card = () => <div />;",
      "packages/ui-old/package.json": JSON.stringify({ name: "ui-old" }),
      "packages/ui-old/src/Card.tsx": "export const Card = () => <div />;",
    });

    expect(
      probeFastRefreshFileStatus(path.join(workspaceDirectory, "packages/ui/src/Card.tsx"))
        .isActive,
    ).toBe(true);
    expect(
      probeFastRefreshFileStatus(path.join(workspaceDirectory, "packages/ui-old/src/Card.tsx"))
        .isActive,
    ).toBe(false);
  });

  it("rejects aliases owned only by a Vite library build", () => {
    const workspaceDirectory = createWorkspaceFixture({
      "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"] }),
      "apps/builder/package.json": JSON.stringify(viteManifest({ build: "vite build" })),
      "apps/builder/vite.config.ts": `
        import react from "@vitejs/plugin-react";
        export default {
          plugins: [react()],
          resolve: { alias: { ui: "../../packages/ui/src" } },
        };
      `,
      "packages/ui/package.json": JSON.stringify({ name: "ui" }),
      "packages/ui/src/Card.tsx": "export const Card = () => <div />;",
    });

    expect(
      probeFastRefreshFileStatus(path.join(workspaceDirectory, "packages/ui/src/Card.tsx"))
        .isActive,
    ).toBe(false);
  });

  it("inherits Fast Refresh through a workspace dependency with a source runtime entry", () => {
    const workspaceDirectory = createWorkspaceFixture({
      "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"] }),
      "apps/web/package.json": JSON.stringify({
        ...viteManifest({ dev: "vite" }),
        dependencies: { react: "19.0.0", ui: "workspace:*", "dist-ui": "workspace:*" },
        peerDependencies: { "peer-ui": "workspace:*" },
      }),
      "apps/web/vite.config.ts":
        'import react from "@vitejs/plugin-react"; export default { plugins: [react()] };',
      "packages/ui/package.json": JSON.stringify({ name: "ui", main: "./src/index.ts" }),
      "packages/ui/src/Card.tsx": "export const Card = () => <div />;",
      "packages/dist-ui/package.json": JSON.stringify({ name: "dist-ui", main: "./dist/index.js" }),
      "packages/dist-ui/src/Card.tsx": "export const Card = () => <div />;",
      "packages/peer-ui/package.json": JSON.stringify({ name: "peer-ui", main: "./src/index.ts" }),
      "packages/peer-ui/src/Card.tsx": "export const Card = () => <div />;",
    });

    expect(
      probeFastRefreshFileStatus(path.join(workspaceDirectory, "packages/ui/src/Card.tsx"))
        .isActive,
    ).toBe(true);
    expect(
      probeFastRefreshFileStatus(path.join(workspaceDirectory, "packages/dist-ui/src/Card.tsx"))
        .isActive,
    ).toBe(false);
    expect(
      probeFastRefreshFileStatus(path.join(workspaceDirectory, "packages/peer-ui/src/Card.tsx"))
        .isActive,
    ).toBe(false);
  });

  it("recognizes an Nx React Vite Storybook development target", () => {
    const activeWorkspace = createWorkspaceFixture({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/ui/package.json": JSON.stringify({ name: "ui" }),
      "packages/ui/project.json": JSON.stringify({
        targets: { "storybook:serve:dev": { options: { port: 6006 } } },
      }),
      "packages/ui/.storybook/main.ts":
        'export default { framework: "@storybook/react-vite", stories: ["../src/**/*.stories.tsx"] };',
      "packages/ui/src/Card.tsx": "export const Card = () => <div />;",
    });
    const staticWorkspace = createWorkspaceFixture({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/ui/package.json": JSON.stringify({ name: "ui" }),
      "packages/ui/project.json": JSON.stringify({
        targets: { "storybook:serve:static": { options: { port: 6006 } } },
      }),
      "packages/ui/.storybook/main.ts":
        'export default { framework: "@storybook/react-vite", stories: ["../src/**/*.stories.tsx"] };',
      "packages/ui/src/Card.tsx": "export const Card = () => <div />;",
    });

    expect(
      probeFastRefreshFileStatus(path.join(activeWorkspace, "packages/ui/src/Card.tsx")).isActive,
    ).toBe(true);
    expect(
      probeFastRefreshFileStatus(path.join(staticWorkspace, "packages/ui/src/Card.tsx")).isActive,
    ).toBe(false);
  });
});
