import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { isReferencedTsconfigAliasCongruentWithVite } from "./is-referenced-tsconfig-alias-congruent-with-vite.js";
import { resetFilesystemCaches } from "./reset-filesystem-caches.js";

interface ViteAliasFixture {
  readonly name: string;
  readonly config: string | null;
  readonly expected: boolean;
  readonly files?: Readonly<Record<string, string>>;
  readonly omitScripts?: boolean;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly specifier?: string;
  readonly resolved?: string;
}

const fixtures: readonly ViteAliasFixture[] = [
  {
    name: "accepts one canonical literal alias",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: true,
  },
  {
    name: "allows unrelated ordinary config and plugin calls",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({plugins:[plugin()],base:"/panel",server:{port:4200},resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: true,
  },
  {
    name: "permits absent Vite under separately proven TS profile",
    config: null,
    expected: true,
  },
  {
    name: "declines wrong selected root",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./other")}}});',
    expected: false,
  },
  {
    name: "declines conflicting React alias",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"react":"./foreign-react", "@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines unknown alias spread",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{...foreignAliases,"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines computed alias key",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{[aliasName]:path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines alias array",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:[{find:"@",replacement:path.resolve(__dirname,"./src")}]}});',
    expected: false,
  },
  {
    name: "declines function configuration",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig(()=>({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}}));',
    expected: false,
  },
  {
    name: "declines a noncanonical factory",
    config:
      'const defineConfig = value => foreign(value);\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines selected path property mutation",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\npath.resolve = foreign;\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines sibling canonical path import mutation",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nimport OtherPath from "path";\nOtherPath.resolve = foreign;\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines path binding escape",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nconst escaped = path;\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines local dirname replacement",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nconst __dirname = "/other";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines explicit dirname assignment",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\n__dirname = "/other";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines explicit esbuild custom JSX factory",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({esbuild:{jsxFactory:"foreign.create"},resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines define React replacement",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({define:{"React":"foreign"},resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines multiple Vite config candidates",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    files: {
      "vite.config.js":
        'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    },
    expected: false,
  },
  {
    name: "declines active alternate config script",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    scripts: {
      build: "vite build --config other.ts",
    },
    expected: false,
  },
  {
    name: "declines alternate config even without default file",
    config: null,
    scripts: {
      build: "vite build --config other.ts",
    },
    expected: false,
  },
  {
    name: "declines visible unsupported Webpack script",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    scripts: {
      build: "webpack --config custom.js",
    },
    expected: false,
  },
  {
    name: "declines visible Webpack dependency",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    dependencies: {
      webpack: "5.0.0",
    },
    expected: false,
  },
  {
    name: "declines visible unsupported Webpack config",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    files: {
      "webpack.config.js": "module.exports = unknown();",
    },
    expected: false,
  },
  {
    name: "declines loader query and path traversal",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    specifier: "@/../outside?raw",
    expected: false,
  },
  {
    name: "declines unrelated resolved source outside alias",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    resolved: "other/control.tsx",
    expected: false,
  },
  {
    name: "declines CommonJS path provider replacement",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nrequire("path").resolve = foreign;\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "allows canonical namespace node path",
    config:
      'import { defineConfig } from "vite";\nimport * as path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: true,
  },
  {
    name: "permits no Vite and absent scripts under canonical TS profile",
    config: null,
    omitScripts: true,
    expected: true,
  },
  {
    name: "requires active Vite build when config exists",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    omitScripts: true,
    expected: false,
  },
  {
    name: "declines createRequire alternate builtin provider",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nimport {createRequire} from "node:module";\nconst load=createRequire(import.meta.url);\nload("node:path").resolve=foreign;\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
  {
    name: "declines dynamic builtin provider import",
    config:
      'import { defineConfig } from "vite";\nimport path from "node:path";\nconst alternate=await import("node:path");\nalternate.default.resolve=foreign;\nexport default defineConfig({resolve:{alias:{"@":path.resolve(__dirname,"./src")}}});',
    expected: false,
  },
];

describe("referenced TypeScript alias Vite congruence", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const directory = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), "rd-vite-congruence-"),
      );
      try {
        fs.mkdirSync(path.join(directory, "src"));
        const filename = path.join(directory, "src", "editor.tsx");
        fs.writeFileSync(filename, "export const value = 1;");
        fs.writeFileSync(path.join(directory, "src", "control.tsx"), "export const value = 1;");
        fs.writeFileSync(path.join(directory, "tsconfig.app.json"), "{}");
        fs.writeFileSync(
          path.join(directory, "package.json"),
          JSON.stringify({
            ...(fixture.omitScripts ? {} : { scripts: fixture.scripts ?? { build: "vite build" } }),
            dependencies: fixture.dependencies ?? { vite: "8.0.0" },
          }),
        );
        if (fixture.config !== null)
          fs.writeFileSync(path.join(directory, "vite.config.ts"), fixture.config);
        for (const [relativePath, contents] of Object.entries(fixture.files ?? {})) {
          fs.writeFileSync(path.join(directory, relativePath), contents);
        }
        resetFilesystemCaches();
        expect(
          isReferencedTsconfigAliasCongruentWithVite({
            rootDirectory: directory,
            fromFilePath: filename,
            specifier: fixture.specifier ?? "@/control",
            resolvedFilePath: path.join(directory, fixture.resolved ?? "src/control.tsx"),
            aliasPattern: "@/*",
            targetPattern: "./src/*",
            baseDirectory: directory,
            configPath: path.join(directory, "tsconfig.app.json"),
          }),
        ).toBe(fixture.expected);
      } finally {
        resetFilesystemCaches();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
