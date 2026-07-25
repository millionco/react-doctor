import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { collectUnpluginAutoImportGlobalScopes } from "../src/runners/oxlint/collect-unplugin-auto-import-global-scopes.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-auto-import-globals-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const writeFile = (rootDirectory: string, relativePath: string, content: string): void => {
  const absolutePath = path.join(rootDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
};

const createCaseDirectory = (name: string): string => {
  const caseDirectory = path.join(temporaryRoot, name);
  fs.mkdirSync(caseDirectory, { recursive: true });
  return caseDirectory;
};

describe("collectUnpluginAutoImportGlobalScopes", () => {
  it("collects current generated globals from active package configs", () => {
    const rootDirectory = createCaseDirectory("active-configs");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import { defineConfig } from "vite";
        import AutoImport from "unplugin-auto-import/vite";
        export default defineConfig({
          plugins: [
            AutoImport({
              imports: ["react-router-dom"],
              eslintrc: {
                enabled: true,
                filepath: "./src/auto-imports.json",
              },
            }),
          ],
        });
      `,
    );
    writeFile(
      rootDirectory,
      "src/auto-imports.json",
      JSON.stringify({
        globals: { LegacyReadonlyComponent: false, Route: "readonly", Routes: "readonly" },
      }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");
    writeFile(rootDirectory, "packages/admin/package.json", "{}");
    writeFile(
      rootDirectory,
      "packages/admin/vite.config.ts",
      `
        import Inject from "unplugin-auto-import/vite";
        export default {
          plugins: [
            Inject({
              imports: ["react-router-dom"],
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      "packages/admin/.eslintrc-auto-import.json",
      JSON.stringify({ globals: { Navigate: true } }),
    );
    writeFile(
      rootDirectory,
      "packages/admin/src/app.tsx",
      "export const App = () => <Navigate />;",
    );

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx", "packages/admin/src/app.tsx"],
      }),
    ).toEqual([
      { directory: "", names: ["LegacyReadonlyComponent", "Route", "Routes"] },
      { directory: "packages/admin", names: ["Navigate"] },
    ]);
  });

  it("keeps inactive nested packages as boundaries for root globals", () => {
    const rootDirectory = createCaseDirectory("nested-boundary");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        export default {
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");
    writeFile(rootDirectory, "packages/admin/package.json", "{}");
    writeFile(rootDirectory, "packages/admin/src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx", "packages/admin/src/app.tsx"],
      }),
    ).toEqual([
      { directory: "", names: ["Route"] },
      { directory: "packages/admin", names: [] },
    ]);
  });

  it("collects generated globals when specific import names are ignored", () => {
    const rootDirectory = createCaseDirectory("ignored-import-names");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        export default {
          plugins: [
            AutoImport({
              ignore: ["useMouse"],
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([{ directory: "", names: ["Route"] }]);
  });

  it("ignores append-only declarations without an active globals config", () => {
    const rootDirectory = createCaseDirectory("stale-declaration");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "src/auto-imports.d.ts",
      `
        // Generated by unplugin-auto-import
        declare global {
          const Route: typeof import("react-router-dom").Route
        }
      `,
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });

  it("stays conservative for custom file filters and unregistered plugin calls", () => {
    const rootDirectory = createCaseDirectory("uncertain-config");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        const unusedPlugin = AutoImport({
          eslintrc: { enabled: true },
        });
        const unusedConfig = {
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
        };
        const filterName = "include";
        export default {
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
            AutoImport({
              include: [/src\\/routes/],
              eslintrc: { enabled: true },
            }),
            AutoImport({
              exclude: [/src\\/admin/],
              eslintrc: { enabled: true },
            }),
            AutoImport({
              ["include"]: [/src\\/routes/],
              eslintrc: { enabled: true },
            }),
            AutoImport({
              ["exclude"]: [/src\\/admin/],
              eslintrc: { enabled: true },
            }),
            AutoImport({
              [filterName]: [/src\\/routes/],
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });

  it("stays conservative for shorthand file filters and globals paths", () => {
    const rootDirectory = createCaseDirectory("shorthand-options");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        const include = [/src\\/routes/];
        const exclude = [/src\\/admin/];
        const filepath = "./src/auto-imports.json";
        export default {
          plugins: [
            AutoImport({
              include,
              eslintrc: { enabled: true },
            }),
            AutoImport({
              exclude,
              eslintrc: { enabled: true },
            }),
            AutoImport({
              eslintrc: { enabled: true, filepath },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(
      rootDirectory,
      "src/auto-imports.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });

  it("ignores auto-import calls nested inside plugin option bags", () => {
    const rootDirectory = createCaseDirectory("nested-plugin-options");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        export default {
          plugins: [
            WrapperPlugin({
              plugins: [
                AutoImport({
                  eslintrc: { enabled: true },
                }),
              ],
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });

  it("does not union globals from ambiguous sibling configs", () => {
    const rootDirectory = createCaseDirectory("ambiguous-configs");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        export default {
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      "webpack.config.js",
      `
        module.exports = {
          plugins: [
            require("unplugin-auto-import/webpack")({
              eslintrc: {
                enabled: true,
                filepath: "./stale-auto-imports.json",
              },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(
      rootDirectory,
      "stale-auto-imports.json",
      JSON.stringify({ globals: { StaleRoute: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });

  it("fails closed when an active sibling config has uncertain filters", () => {
    const rootDirectory = createCaseDirectory("uncertain-sibling-config");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        export default {
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      "webpack.config.js",
      `
        module.exports = {
          plugins: [
            require("unplugin-auto-import/webpack")({
              include: [/src\\/routes/],
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });

  it("collects CommonJS webpack and rspack globals", () => {
    const rootDirectory = createCaseDirectory("commonjs-configs");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "webpack.config.cjs",
      `
        const AutoImport = require("unplugin-auto-import/webpack");
        module.exports = {
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");
    writeFile(rootDirectory, "packages/admin/package.json", "{}");
    writeFile(
      rootDirectory,
      "packages/admin/rspack.config.js",
      `
        module.exports = {
          plugins: [
            require("unplugin-auto-import/rspack")({
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      "packages/admin/.eslintrc-auto-import.json",
      JSON.stringify({ globals: { Navigate: "readonly" } }),
    );
    writeFile(
      rootDirectory,
      "packages/admin/src/app.tsx",
      "export const App = () => <Navigate />;",
    );

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx", "packages/admin/src/app.tsx"],
      }),
    ).toEqual([
      { directory: "", names: ["Route"] },
      { directory: "packages/admin", names: ["Navigate"] },
    ]);
  });

  it("collects Astro globals from exported integrations", () => {
    const rootDirectory = createCaseDirectory("astro-config");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "astro.config.mjs",
      `
        import AutoImport from "unplugin-auto-import/astro";
        export default {
          integrations: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { AstroRoute: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <AstroRoute />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([{ directory: "", names: ["AstroRoute"] }]);
  });

  it("collects globals from symlinked config files", () => {
    const rootDirectory = createCaseDirectory("symlinked-config");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "config-source.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        export default {
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    fs.symlinkSync(
      path.join(rootDirectory, "config-source.ts"),
      path.join(rootDirectory, "vite.config.ts"),
      "file",
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { LinkedRoute: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <LinkedRoute />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([{ directory: "", names: ["LinkedRoute"] }]);
  });

  it("collects globals from active esbuild build calls", () => {
    const rootDirectory = createCaseDirectory("esbuild-config");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "esbuild.config.ts",
      `
        import { build as buildProject } from "esbuild";
        import AutoImport from "unplugin-auto-import/esbuild";
        buildProject({
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
        });
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { EsbuildRoute: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <EsbuildRoute />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([{ directory: "", names: ["EsbuildRoute"] }]);
  });

  it.each([
    [
      "destructured build binding",
      `
        const { build: buildProject } = require("esbuild");
        buildProject({
          plugins: [
            require("unplugin-auto-import/esbuild")({
              eslintrc: { enabled: true },
            }),
          ],
        });
      `,
    ],
    [
      "namespace build binding",
      `
        const esbuild = require("esbuild");
        esbuild.build({
          plugins: [
            require("unplugin-auto-import/esbuild")({
              eslintrc: { enabled: true },
            }),
          ],
        });
      `,
    ],
    [
      "required build binding",
      `
        const buildProject = require("esbuild").build;
        buildProject({
          plugins: [
            require("unplugin-auto-import/esbuild")({
              eslintrc: { enabled: true },
            }),
          ],
        });
      `,
    ],
    [
      "direct require",
      `
        require("esbuild").build({
          plugins: [
            require("unplugin-auto-import/esbuild")({
              eslintrc: { enabled: true },
            }),
          ],
        });
      `,
    ],
  ])("collects CommonJS esbuild globals from %s", (caseName, configSource) => {
    const rootDirectory = createCaseDirectory(`esbuild-commonjs-${caseName.replaceAll(" ", "-")}`);
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(rootDirectory, "esbuild.config.cjs", configSource);
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { EsbuildRoute: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <EsbuildRoute />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([{ directory: "", names: ["EsbuildRoute"] }]);
  });

  it("ignores auto-import plugins behind runtime conditions", () => {
    const rootDirectory = createCaseDirectory("conditional-plugins");
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(
      rootDirectory,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        const isEnabled = false;
        export default {
          plugins: [
            isEnabled && AutoImport({
              eslintrc: { enabled: true },
            }),
            isEnabled
              ? AutoImport({
                  eslintrc: { enabled: true },
                })
              : null,
            ...(isEnabled
              ? [
                  AutoImport({
                    eslintrc: { enabled: true },
                  }),
                ]
              : []),
          ],
        };
      `,
    );
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "a conditionally exported Vite config",
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        const isEnabled = false;
        export default isEnabled
          ? {
              plugins: [
                AutoImport({
                  eslintrc: { enabled: true },
                }),
              ],
            }
          : { plugins: [] };
      `,
    ],
    [
      "an esbuild call behind a runtime gate",
      "esbuild.config.ts",
      `
        import { build } from "esbuild";
        import AutoImport from "unplugin-auto-import/esbuild";
        const isEnabled = false;
        if (isEnabled) {
          build({
            plugins: [
              AutoImport({
                eslintrc: { enabled: true },
              }),
            ],
          });
        }
      `,
    ],
  ])("ignores %s", (caseName, configFilename, configSource) => {
    const rootDirectory = createCaseDirectory(caseName.replaceAll(" ", "-"));
    writeFile(rootDirectory, "package.json", "{}");
    writeFile(rootDirectory, configFilename, configSource);
    writeFile(
      rootDirectory,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(rootDirectory, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });

  it("stays conservative when spreads can override config or plugin options", () => {
    const optionSpreadRoot = createCaseDirectory("option-spread");
    writeFile(optionSpreadRoot, "package.json", "{}");
    writeFile(
      optionSpreadRoot,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        const options = { include: [/src\\\\/routes/] };
        export default {
          plugins: [
            AutoImport({
              ...options,
              eslintrc: { enabled: true },
            }),
          ],
        };
      `,
    );
    writeFile(
      optionSpreadRoot,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(optionSpreadRoot, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory: optionSpreadRoot,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);

    const eslintrcSpreadRoot = createCaseDirectory("eslintrc-spread");
    writeFile(eslintrcSpreadRoot, "package.json", "{}");
    writeFile(
      eslintrcSpreadRoot,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        const eslintrc = { filepath: "./src/auto-imports.json" };
        export default {
          plugins: [
            AutoImport({
              eslintrc: {
                ...eslintrc,
                enabled: true,
              },
            }),
          ],
        };
      `,
    );
    writeFile(
      eslintrcSpreadRoot,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(eslintrcSpreadRoot, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory: eslintrcSpreadRoot,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);

    const configSpreadRoot = createCaseDirectory("config-spread");
    writeFile(configSpreadRoot, "package.json", "{}");
    writeFile(
      configSpreadRoot,
      "vite.config.ts",
      `
        import AutoImport from "unplugin-auto-import/vite";
        const config = { plugins: [] };
        export default {
          plugins: [
            AutoImport({
              eslintrc: { enabled: true },
            }),
          ],
          ...config,
        };
      `,
    );
    writeFile(
      configSpreadRoot,
      ".eslintrc-auto-import.json",
      JSON.stringify({ globals: { Route: "readonly" } }),
    );
    writeFile(configSpreadRoot, "src/app.tsx", "export const App = () => <Route />;");

    expect(
      collectUnpluginAutoImportGlobalScopes({
        rootDirectory: configSpreadRoot,
        candidateFiles: ["src/app.tsx"],
      }),
    ).toEqual([]);
  });
});
