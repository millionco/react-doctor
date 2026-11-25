import { describe, expect, it } from "vite-plus/test";
import { readGeneratedStencil2Lifecycle } from "./read-generated-stencil2-lifecycle.js";

const scripts = {
  prod: "pnpm run compile",
  precompile: "run-p generate:*",
  compile: "cross-env NODE_ENV=production run-s compile:elements",
  "compile:elements": "stencil build",
  "generate:stencil-config":
    "esbuild ./scripts/element-config.ts --external:lightningcss --bundle --platform=node --outfile=stencil.config.js",
  "generate:lib": "mkdirp lib",
};

const readLifecycle = (changes: Readonly<Record<string, string | undefined>> = {}) =>
  readGeneratedStencil2Lifecycle(JSON.stringify({ scripts: { ...scripts, ...changes } }));

describe("generated Stencil 2 build declarations", () => {
  it("requires the declared generation to precede the production compiler", () => {
    expect(readLifecycle()).toMatchObject({
      buildTask: "compile",
      componentTask: "compile:elements",
      source: "./scripts/element-config.ts",
      generatedConfig: "stencil.config.js",
      createsLibraryDirectory: true,
    });
  });

  it.each([
    { precompile: undefined },
    { compile: "stencil build" },
    { compile: "cross-env NODE_ENV=development run-s compile:elements" },
    { "compile:elements": "stencil build --watch" },
    { "generate:env": "node ./scripts/prepare.js" },
    { "generate:lib": "mkdirp public" },
    { postcompile: "node ./scripts/postprocess.js" },
    {
      "generate:stencil-config": scripts["generate:stencil-config"].replace(
        "--platform=node",
        "--platform=browser",
      ),
    },
  ])("refuses a different generation or compiler path", (changes) => {
    expect(readLifecycle(changes)).toBeNull();
  });
});
