import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

vi.mock(
  "../../utils/stock-vite-providers/resolve-stock-physical-entry.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../utils/stock-vite-providers/resolve-stock-physical-entry.js")
      >();
    return {
      ...actual,
      resolveStockPhysicalEntry: (
        request: Parameters<typeof actual.resolveStockPhysicalEntry>[0],
      ) => {
        const packageDirectory = path.join(
          request.projectRoot,
          "node_modules",
          request.contract.packageName,
        );
        const member = request.specifier.endsWith("/jsx-runtime")
          ? "jsx-runtime.js"
          : request.specifier.endsWith("/client")
            ? "client.js"
            : "index.js";
        return { packageDirectory, entry: path.join(packageDirectory, member) };
      },
    };
  },
);

const viteConfig = `
import fs from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import styles from "@tailwindcss/vite";
import { designCss } from "./build/design-css.js";

const settingsFile = fileURLToPath(new URL("./site-build.json", import.meta.url));
const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")) : null;

function localServer() {
  return { name: "local-tools", configureServer(server) {} };
}

export default defineConfig({
  base: settings?.base || "/",
  plugins: [designCss(), localServer(), react(), styles()],
  server: { host: "127.0.0.1", port: 4812, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: {
    outDir: settings?.outDir || "dist",
    emptyOutDir: Boolean(settings?.emptyOutDir),
    rollupOptions: { output: { manualChunks(id) { if (id.includes("charts")) { return "charts"; } return undefined; } } },
  },
});
`;

const designWriter = `
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..");
const paletteFile = path.join(project, "design", "theme.js");
const output = path.join(project, "src", "palette.css");

function asUrl(location) { return "file:///" + location.split(path.sep).join("/"); }
async function load() {
  const palette = await import(\`\${asUrl(paletteFile)}?t=\${Date.now()}\`);
  return { palette };
}
function keyName(key) { return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); }
function format({ palette }) {
  const lines = [];
  lines.push("/* Design token declarations. */");
  lines.push(":root {");
  for (const [name, value] of Object.entries(palette.colors)) {
    lines.push(\`--theme-\${keyName(name)}: \${value};\`);
  }
  lines.push("}");
  return lines.join("\\n");
}
async function refresh() {
  const data = await load();
  const text = format(data);
  const previous = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : null;
  if (previous === text) { return false; }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, text, "utf8");
  return true;
}
export function designCss() {
  return { name: "author-design", async buildStart() { await refresh(); }, configureServer(server) {} };
}
`;

vi.mock("../../utils/read-flat-npm-workspace-vite-build.js", () => ({
  readFlatNpmWorkspaceViteBuild: () => ({ npmDispatcherVerified: true }),
}));

const implicitSite = "export default function Widget() { return <p>Good morning</p>; }";
const subject = "site/src/Widget.jsx";
const workspaces: string[] = [];

const fixture = (overrides: Readonly<Record<string, string>> = {}) => {
  const workspace = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), "react-doctor-stock-vite-css-")),
  );
  const project = path.join(workspace, "site");
  workspaces.push(workspace);
  const files: Readonly<Record<string, string>> = {
    "package.json": JSON.stringify({
      name: "workspace",
      workspaces: ["site"],
      scripts: { build: "npm --workspace site run build" },
    }),
    "site/package.json": JSON.stringify({
      name: "@example/site",
      type: "module",
      scripts: { build: "vite build" },
    }),
    "site/index.html":
      '<main id="root"></main><script type="module" src="/src/entry.jsx"></script>',
    "site/vite.config.js": viteConfig,
    "site/postcss.config.js": "export default {};",
    "site/build/design-css.js": designWriter,
    "site/design/theme.js": 'export const colors = Object.freeze({accent: "#345678"});',
    "site/src/screen.css": '@import "./palette.css";\nmain { color: var(--theme-accent); }',
    "site/src/palette.css": ":root { --theme-accent: #345678; }",
    "site/src/entry.jsx":
      'import { createRoot } from "react-dom/client"; import Site from "./Site.jsx"; import "./screen.css"; createRoot(document.getElementById("root")).render(<Site />);',
    "site/src/Site.jsx":
      'import { lazy, Suspense } from "react"; const Screen = lazy(() => import("./Screen.jsx")); export default function Site() { return <Suspense fallback={null}><Screen /></Suspense>; }',
    "site/src/Screen.jsx":
      'import Widget from "./Widget.jsx"; export default function Screen() { return <main><Widget /></main>; }',
    [subject]: implicitSite,
    ...overrides,
  };
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  return {
    filename: path.join(workspace, subject),
    settings: { "react-doctor": { rootDirectory: project } },
  };
};

afterEach(() => {
  for (const workspace of workspaces.splice(0))
    fs.rmSync(workspace, { recursive: true, force: true });
});

describe("stock Vite automatic JSX and generated CSS", () => {
  it("recognizes the JSX in a reached lazy module", () => {
    const result = runRule(reactInJsxScope, implicitSite, fixture());
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a JSX tag that explicitly evaluates unbound React", () => {
    const source =
      "export default function Widget() { return <React.Fragment><p /></React.Fragment>; }";
    const result = runRule(reactInJsxScope, source, fixture({ [subject]: source }));
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each<Readonly<Record<string, string>>>([
    { "site/vite.config.js": viteConfig.replace("react()", 'react({ jsxRuntime: "classic" })') },
    {
      "site/build/design-css.js": designWriter.replace(
        '"/* Design token declarations. */"',
        `'@plugin "./external.js";'`,
      ),
    },
    { "site/design/theme.js": 'export const colors = { accent: "blue; } @plugin hidden;" };' },
    { "site/.postcssrc.json": '{"plugins":{}}' },
    { "site/src/screen.css": '@config "../other.js";' },
    { "site/site-build.json": '{"outDir":"elsewhere"}' },
    { "site/src/tsconfig.json": '{"compilerOptions":{"jsx":"react"}}' },
    { "site/src/Screen.jsx": "export default function Screen() { return <main />; }" },
  ])("retains the warning when a build or route premise changes", (overrides) => {
    expect(runRule(reactInJsxScope, implicitSite, fixture(overrides)).diagnostics).toHaveLength(1);
  });
});
