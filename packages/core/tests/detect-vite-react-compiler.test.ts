import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { detectReactCompiler } from "../src/project-info/detect-react-compiler.js";
import type { PackageJson } from "../src/types/index.js";

const temporaryRoots: string[] = [];

const withViteConfig = (filename: string, content: string, packageJson?: PackageJson): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-vite-compiler-"));
  temporaryRoots.push(directory);
  fs.mkdirSync(path.join(directory, ".git"));
  fs.writeFileSync(path.join(directory, filename), content, "utf-8");
  const manifest: PackageJson = packageJson ?? {
    name: "test-vite-compiler",
    dependencies: { react: "^19.2.0" },
    devDependencies: {
      "@vitejs/plugin-react": "6.1.1",
      "oxc-transform-react": "0.145.0",
    },
  };
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest), "utf-8");
  return directory;
};

afterAll(() => {
  for (const directory of temporaryRoots) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("detectReactCompiler with @vitejs/plugin-react compiler option", () => {
  it("detects compiler: true in default import call", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react from '@vitejs/plugin-react';
export default { plugins: [react({ compiler: true })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("detects compiler: {} (truthy empty object)", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react from '@vitejs/plugin-react';
export default { plugins: [react({ compiler: {} })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("detects compiler with non-empty options object", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react from '@vitejs/plugin-react';
export default { plugins: [react({ compiler: { target: '19' } })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("does NOT detect compiler: false", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react from '@vitejs/plugin-react';
export default { plugins: [react({ compiler: false })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(false);
  });

  it("does NOT detect when compiler option is absent", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react from '@vitejs/plugin-react';
export default { plugins: [react()] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(false);
  });

  it("detects compiler in namespace import pattern", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import * as viteReact from '@vitejs/plugin-react';
export default { plugins: [viteReact.default({ compiler: true })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("detects compiler with aliased import", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import viteReact from '@vitejs/plugin-react';
export default { plugins: [viteReact({ compiler: true })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("detects compiler with CommonJS require", () => {
    const directory = withViteConfig(
      "vite.config.js",
      `const react = require('@vitejs/plugin-react');
module.exports = { plugins: [react({ compiler: true })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("detects compiler with require().default pattern", () => {
    const directory = withViteConfig(
      "vite.config.js",
      `const react = require('@vitejs/plugin-react').default;
module.exports = { plugins: [react({ compiler: true })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("detects compiler with inline require", () => {
    const directory = withViteConfig(
      "vite.config.js",
      `module.exports = { plugins: [require('@vitejs/plugin-react')({ compiler: true })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("detects compiler with variable reference to options", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react from '@vitejs/plugin-react';
const options = { compiler: true };
export default { plugins: [react(options)] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("detects compiler with spread operator", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react from '@vitejs/plugin-react';
const base = { jsxImportSource: '@emotion/react' };
export default { plugins: [react({ ...base, compiler: true })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });

  it("does NOT detect when compiler is on unrelated plugin", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react from '@vitejs/plugin-react';
import other from 'some-other-plugin';
export default { plugins: [react(), other({ compiler: true })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(false);
  });

  it("still detects reactCompilerPreset (existing pattern)", () => {
    const directory = withViteConfig(
      "vite.config.ts",
      `import react, { reactCompilerPreset } from '@vitejs/plugin-react';
export default { plugins: [react({ babel: { presets: [reactCompilerPreset()] } })] };`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
    ) as PackageJson;
    expect(detectReactCompiler(directory, manifest)).toBe(true);
  });
});
