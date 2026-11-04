import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noDeprecatedTailwindClass } from "./no-deprecated-tailwind-class.js";

const imports = `import { clsx as join } from "clsx"; import { twMerge as merge } from "tailwind-merge";`;
const wrapper = `${imports} function classes(...values) { return merge(join(values)); }`;
let projectDirectory: string;

beforeEach(() => {
  projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "closed-class-merger-"));
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({
      dependencies: { "tailwind-merge": "3.4.0", clsx: "2.1.1" },
      devDependencies: {
        vite: "7.3.2",
        "@vitejs/plugin-react": "5.1.2",
        "@tailwindcss/vite": "4.1.17",
      },
    }),
  );
  __clearParseSourceFileCacheForTests();
  resetManifestCaches();
  resetCrossFileExportCaches();
  resetTsconfigAliasCaches();
});

afterEach(() => fs.rmSync(projectDirectory, { recursive: true, force: true }));

describe("no-deprecated-tailwind-class closed canonical merger", () => {
  it.each([
    [
      "base and optional unrelated class",
      `classes("bg-gradient-to-r from-black", flag && "flex-col")`,
      1,
    ],
    ["nested false guards", `classes("bg-gradient-to-r", first && !second && "flex-col")`, 1],
    [
      "closed conditional unrelated class",
      `classes("bg-gradient-to-r", flag ? "flex-col" : "flex-row")`,
      1,
    ],
    ["literal falsy arguments", `classes("bg-gradient-to-r", false, null, undefined, 0, "")`, 1],
    ["legacy removed by later background color", `classes("bg-gradient-to-r", "bg-red-500")`, 0],
    ["legacy after background color", `classes("bg-red-500", "bg-gradient-to-r")`, 1],
    ["legacy before background none", `classes("bg-gradient-to-r", "bg-none")`, 1],
    ["legacy after background none", `classes("bg-none", "bg-gradient-to-r")`, 1],
    ["unclassified legacy text overflow survives", `classes("overflow-ellipsis", "text-clip")`, 1],
    ["legacy text overflow last", `classes("text-clip", "overflow-ellipsis")`, 1],
    ["legacy flex tokens", `classes("flex-grow flex-shrink-0")`, 2],
    ["mixed gradient and legacy flex", `classes("bg-gradient-to-r flex-shrink-0")`, 2],
    ["variant scope retained", `classes("hover:bg-gradient-to-r", "bg-red-500")`, 1],
    ["same variant removed", `classes("hover:bg-gradient-to-r", "hover:bg-red-500")`, 0],
    ["important scope retained", `classes("!bg-gradient-to-r", "bg-red-500")`, 1],
    ["same important scope removed", `classes("!bg-gradient-to-r", "!bg-red-500")`, 0],
    [
      "conditional removal is not guaranteed",
      `classes("bg-gradient-to-r", flag && "bg-red-500")`,
      0,
    ],
    [
      "correlated branches are not mixed into a finding",
      `classes(flag ? "bg-gradient-to-r" : "", flag ? "bg-red-500" : "")`,
      0,
    ],
    ["unknown string declines", `classes("bg-gradient-to-r", className)`, 0],
    ["unknown fallback declines", `classes("bg-gradient-to-r", className || "flex-col")`, 0],
    ["object arguments decline", `classes("bg-gradient-to-r", { "flex-col": flag })`, 0],
    ["spread arguments decline", `classes("bg-gradient-to-r", ...other)`, 0],
    ["value transform declines", `classes("bg-gradient-to-r").replace("gradient", "linear")`, 0],
    ["later spread overrides", `classes("bg-gradient-to-r")} {...props`, 0],
  ])("%s", (_name, expression, count) => {
    const code = `${wrapper}; const View = () => <div className={${expression}} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });

  it.each([
    ["function replacement", `${wrapper}; classes = (...values) => "";`],
    [
      "hidden function replacement",
      `${wrapper}; try { throw {}; } catch ({ unused = (classes = (...values) => "") }) {}`,
    ],
    [
      "default parameter environment replacement",
      `${wrapper}; function replace(value = (classes = (...values) => "")) { var classes; } replace();`,
    ],
    [
      "parameter replacement",
      `${imports} function classes(...values) { values = []; return merge(join(values)); }`,
    ],
    [
      "transform inside wrapper",
      `${imports} function classes(...values) { return merge(join(values)).replace("gradient", "linear"); }`,
    ],
    [
      "custom merger",
      `import { clsx as join } from "clsx"; import { extendTailwindMerge } from "tailwind-merge"; const merge = extendTailwindMerge({}); function classes(...values) { return merge(join(values)); }`,
    ],
    [
      "shadowed merger",
      `${imports} function classes(...values) { const merge = () => ""; return merge(join(values)); }`,
    ],
    [
      "shadowed normalizer",
      `${imports} function classes(...values) { const join = () => ""; return merge(join(values)); }`,
    ],
    ["foreign helper", `function classes(...values) { return ""; }`],
    ["opaque direct eval", `${wrapper}; eval("classes = (...values) => ''");`],
  ])("declines %s", (_name, prefix) => {
    const code = `${prefix}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "^3.4.0",
    "~3.4.0",
    "3.4.1",
    "3.3.0",
    "3.4.0-beta.1",
    "workspace:3.4.0",
    "npm:foreign@3.4.0",
  ])("declines unsupported merger version %s", (version) => {
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ dependencies: { "tailwind-merge": version, clsx: "2.1.1" } }),
    );
    const result = runRule(
      noDeprecatedTailwindClass,
      `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`,
      { filename: path.join(projectDirectory, "view.tsx") },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves an imported canonical wrapper under its owning package", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "classes.ts"),
      `${imports} export function cn(...values) { return merge(join(values)); }`,
    );
    const code = `import { cn as classes } from "./classes"; const View = () => <div {...props} className={classes("bg-gradient-to-r", flag && "flex-col")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts const wrapper and argument aliases", () => {
    const code = `${imports} const classes = (...values) => merge(join(values)); const alias = classes; const base = "bg-gradient-to-r"; const View = () => <div className={alias(base)} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts the canonical default clsx export", () => {
    const code = `import join from "clsx"; import { twMerge as merge } from "tailwind-merge"; const classes = (...values) => merge(join(values)); const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "shadowed wrapper",
      `${wrapper}; function View({ classes }) { return <div className={classes("bg-gradient-to-r")} />; }`,
    ],
    [
      "overridden className",
      `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} className="bg-red-500" />;`,
    ],
    [
      "dynamic template",
      `${wrapper}; const View = () => <div className={classes(\`bg-gradient-to-\${direction}\`)} />;`,
    ],
    [
      "hidden argument replacement",
      `${wrapper}; let base = "bg-gradient-to-r"; try { throw {}; } catch ({ unused = (base = "") }) {} const View = () => <div className={classes(base)} />;`,
    ],
    [
      "alternative overflow",
      `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r", ${Array.from({ length: 7 }, (_unused, index) => `flag${index} ? "gap-${index}" : "p-${index}"`).join(",")})} />;`,
    ],
    [
      "alias cycle",
      `${wrapper}; const first = second; const second = first; const View = () => <div className={classes(first)} />;`,
    ],
  ])("declines %s", (_name, code) => {
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not confuse a wrapper package version with the consumer version", () => {
    fs.mkdirSync(path.join(projectDirectory, "helpers"));
    fs.writeFileSync(
      path.join(projectDirectory, "helpers", "package.json"),
      JSON.stringify({ dependencies: { "tailwind-merge": "3.3.0", clsx: "2.1.1" } }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "helpers", "classes.ts"),
      `${imports} export function cn(...values) { return merge(join(values)); }`,
    );
    const code = `import { cn } from "./helpers/classes"; const View = () => <div className={cn("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a tsconfig alias replacing a canonical provider", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "tailwind-merge": ["./foreign.ts"] } },
      }),
    );
    fs.writeFileSync(path.join(projectDirectory, "foreign.ts"), `export const twMerge = () => "";`);
    const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses an installed exact version rather than the declared lower bound", () => {
    fs.mkdirSync(path.join(projectDirectory, "node_modules", "tailwind-merge"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectDirectory, "node_modules", "tailwind-merge", "package.json"),
      JSON.stringify({ version: "3.4.1" }),
    );
    const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["tsconfig.json", `{`],
    ["tsconfig.json", `{} /* unfinished`],
    ["tsconfig.json", JSON.stringify({ extends: "./missing.json" })],
    [
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "tailwind-merge": ["./absent"] } } }),
    ],
    [
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "tailwind-merge": "./absent" } } }),
    ],
    ["jsconfig.json", JSON.stringify({ compilerOptions: { paths: { "*": ["./elsewhere/*"] } } })],
    ["vite.config.ts", `export default obtainConfig();`],
    ["vite.config.ts", `export default { resolve: { alias: { "tailwind-merge": "./other" } } };`],
    ["vite.config.ts", `export default { resolve: { alias: { ...unknownAliases } } };`],
    [
      "vite.config.ts",
      `export default { resolve: { alias: [{ find: /tailwind-merge/, replacement: "./other" }] } };`,
    ],
    ["vite.config.ts", `import custom from "./custom"; export default { plugins: [custom()] };`],
    [
      "vite.config.ts",
      `import react from "@vitejs/plugin-react"; export default { plugins: [react({ babel: unknown })] };`,
    ],
    [
      "vite.config.ts",
      `export default { plugins: [(() => ({ name: "resolver", resolveId() { return "./other"; } }))()] };`,
    ],
    ["webpack.config.js", `module.exports = { resolve: { alias: { clsx: "./other" } } };`],
  ])("declines opaque or replacing config %s / %s", (filename, contents) => {
    fs.writeFileSync(path.join(projectDirectory, filename), contents);
    const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts closed unrelated aliases and logger-only Vite hooks", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "#widgets/*": ["./widgets/*"] } } }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "vite.config.ts"),
      `
import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
const diagnostics = () => ({
  name: "quiet-diagnostics",
  configResolved(settings) {
    const previous = settings.logger.warn;
    settings.logger.warn = (message) => {
      if (message.includes("ignore this warning")) return;
      previous(message);
    };
  },
});
export default defineConfig(() => ({ plugins: [diagnostics(), react()], resolve: { alias: { "#widgets": path.resolve(__dirname, "widgets") } } }));`,
    );
    const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("declines a local hook that accesses module resolution", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "vite.config.ts"),
      `const plugin = () => ({ name: "replacement", configResolved(settings) { settings.resolve.alias = { clsx: "./other" }; } }); export default { plugins: [plugin()] };`,
    );
    const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves punctuation inside inherited config filenames", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "tsconfig.json"),
      JSON.stringify({ extends: "./parent, }.json" }),
    );
    fs.writeFileSync(path.join(projectDirectory, "parent }.json"), "{}");
    fs.writeFileSync(
      path.join(projectDirectory, "parent, }.json"),
      JSON.stringify({ compilerOptions: { paths: { clsx: ["./other"] } } }),
    );
    const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rechecks provider config with a warm imported wrapper AST", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "classes.ts"),
      `${imports} export function cn(...values) { return merge(join(values)); }`,
    );
    const code = `import { cn } from "./classes"; const View = () => <div className={cn("bg-gradient-to-r")} />;`;
    const options = { filename: path.join(projectDirectory, "view.tsx"), includeLocations: true };
    const first = runRule(noDeprecatedTailwindClass, code, options);
    expect(first.parseErrors).toEqual([]);
    expect(first.diagnostics).toHaveLength(1);
    const configPath = path.join(projectDirectory, "tsconfig.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compilerOptions: { paths: { "tailwind-merge": ["./missing"] } } }),
    );
    const replaced = runRule(noDeprecatedTailwindClass, code, options);
    expect(replaced).toEqual({ parseErrors: [], diagnostics: [] });
    fs.rmSync(configPath);
    expect(runRule(noDeprecatedTailwindClass, code, options)).toEqual(first);
    const vitePath = path.join(projectDirectory, "vite.config.ts");
    fs.writeFileSync(vitePath, `export default { resolve: { alias: { clsx: "./other" } } };`);
    expect(runRule(noDeprecatedTailwindClass, code, options)).toEqual({
      parseErrors: [],
      diagnostics: [],
    });
    fs.rmSync(vitePath);
    expect(runRule(noDeprecatedTailwindClass, code, options)).toEqual(first);
  });

  it.each(["@/classes", "./good/classes"])(
    "declines a wrapper redirected by bundler alias %s",
    (specifier) => {
      fs.mkdirSync(path.join(projectDirectory, "good"));
      fs.mkdirSync(path.join(projectDirectory, "foreign"));
      fs.writeFileSync(
        path.join(projectDirectory, "good", "classes.ts"),
        `${imports} export function cn(...values) { return merge(join(values)); }`,
      );
      fs.writeFileSync(
        path.join(projectDirectory, "foreign", "classes.ts"),
        `export function cn(...values) { return ""; }`,
      );
      fs.writeFileSync(
        path.join(projectDirectory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { "@/*": ["./good/*"] } } }),
      );
      fs.writeFileSync(
        path.join(projectDirectory, "vite.config.ts"),
        `export default {resolve:{alias:{${JSON.stringify(specifier === "@/classes" ? "@" : specifier)}:"./foreign/classes"}}};`,
      );
      const code = `import { cn } from ${JSON.stringify(specifier)}; const View = () => <div className={cn("bg-gradient-to-r")} />;`;
      const result = runRule(noDeprecatedTailwindClass, code, {
        filename: path.join(projectDirectory, "view.tsx"),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("declines unclosed barrel edges", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "classes.ts"),
      `${imports} export function cn(...values) { return merge(join(values)); }`,
    );
    fs.writeFileSync(path.join(projectDirectory, "barrel.ts"), `export { cn } from "./classes";`);
    const code = `import { cn } from "./barrel"; const View = () => <div className={cn("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("declines a symlinked wrapper ownership boundary", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "real-classes.ts"),
      `${imports} export function cn(...values) { return merge(join(values)); }`,
    );
    fs.symlinkSync(
      path.join(projectDirectory, "real-classes.ts"),
      path.join(projectDirectory, "classes.ts"),
    );
    const code = `import { cn } from "./classes"; const View = () => <div className={cn("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    { overrides: { "tailwind-merge": "npm:foreign@3.4.0" } },
    { resolutions: { "**/clsx": "other" } },
    { pnpm: { patchedDependencies: { "clsx@2.1.1": "change.patch" } } },
    { browser: { clsx: "./other" } },
    { alias: { clsx: "./other" } },
    { scripts: { build: "vite build --config alternate.ts" } },
    { scripts: { build: "vite build -c alternate.ts" } },
    { name: "clsx" },
  ])("declines provider selectors %s", (metadata) => {
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ dependencies: { "tailwind-merge": "3.4.0", clsx: "2.1.1" }, ...metadata }),
    );
    const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["tailwind-merge", "npm:foreign@3.4.0", "foreign", "3.4.0", 0],
    ["tailwind-merge", "file:./foreign", "foreign", "3.4.0", 0],
    ["tailwind-merge", "3.4.0", "foreign", "3.4.0", 0],
    ["clsx", "npm:foreign@2.1.1", "foreign", "2.1.1", 0],
    ["clsx", "2.1.1", "foreign", "2.1.1", 0],
    ["tailwind-merge", "3.4.0", "tailwind-merge", "3.4.0", 1],
    ["tailwind-merge", "^3.4.0", "tailwind-merge", "3.4.0", 1],
  ])(
    "checks installed provider origin %s / %s / %s",
    (packageName, specifier, installedName, version, count) => {
      fs.writeFileSync(
        path.join(projectDirectory, "package.json"),
        JSON.stringify({
          dependencies: { "tailwind-merge": "3.4.0", clsx: "2.1.1", [packageName]: specifier },
        }),
      );
      const packagePath = path.join(projectDirectory, "node_modules", packageName);
      fs.mkdirSync(packagePath, { recursive: true });
      fs.writeFileSync(
        path.join(packagePath, "package.json"),
        JSON.stringify({ name: installedName, version }),
      );
      const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
      const result = runRule(noDeprecatedTailwindClass, code, {
        filename: path.join(projectDirectory, "view.tsx"),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(count);
    },
  );

  it.each([
    { devDependencies: { vite: "7.3.2", "@vitejs/plugin-react": "file:./foreign" } },
    { overrides: { "@vitejs/plugin-react": "file:./foreign" } },
    { pnpm: { patchedDependencies: { "@vitejs/plugin-react@5.1.2": "foreign.patch" } } },
    { overrides: { vite: "npm:foreign@7.3.2" } },
    { overrides: { "@tailwindcss/vite": "file:./foreign" } },
    { overrides: { path: "file:./foreign" } },
  ])("declines replaced config SDK providers %s", (metadata) => {
    const original = JSON.parse(
      fs.readFileSync(path.join(projectDirectory, "package.json"), "utf8"),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ ...original, ...metadata }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "vite.config.ts"),
      `import react from "@vitejs/plugin-react"; export default { plugins: [react()] };`,
    );
    const code = `${wrapper}; const View = () => <div className={classes("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
