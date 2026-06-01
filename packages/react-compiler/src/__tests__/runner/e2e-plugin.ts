/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Vite transform plugin that mirrors facebook/react's e2e jest transform
 * (compiler/packages/babel-plugin-react-compiler/scripts/jest/makeTransform.ts):
 * `.e2e.js` test files are run through Babel with the React Compiler (forget
 * mode) or without it (baseline), then their JSX is lowered by
 * `@babel/preset-react`. The compiler plugin runs before the preset so it sees
 * raw JSX, matching the upstream `passPerPreset` ordering.
 */

import * as babel from "@babel/core";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {Plugin} from "vite";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_ENTRY = path.resolve(HERE, "..", "..", "..", "dist", "index.js");

const E2E_RE = /[\\/]__tests__[\\/]e2e[\\/].*\.e2e\.(js|tsx)$/;

interface CompilerModule {
  default: babel.PluginObj;
  validateEnvironmentConfig: (config: unknown) => unknown;
}

export const reactCompilerTransform = (useForget: boolean): Plugin => {
  let compiler: CompilerModule | null = null;
  return {
    name: `react-compiler-e2e-${useForget ? "forget" : "no-forget"}`,
    enforce: "pre",
    transform(code, id) {
      if (!E2E_RE.test(id)) {
        return null;
      }
      if (compiler == null) {
        compiler = require(DIST_ENTRY) as CompilerModule;
      }
      const plugins: Array<babel.PluginItem> = [];
      if (useForget) {
        const environment = compiler.validateEnvironmentConfig({
          enableAssumeHooksFollowRulesOfReact: true,
        });
        plugins.push([compiler.default, {environment}]);
      }
      const result = babel.transformSync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        parserOpts: {plugins: ["jsx"]},
        // Plugins run before presets, so the compiler transforms raw JSX
        // before @babel/preset-react lowers it to `jsx(...)` calls.
        plugins,
        presets: [[require.resolve("@babel/preset-react"), {runtime: "automatic"}]],
        sourceMaps: true,
      });
      if (result?.code == null) {
        return null;
      }
      return {code: result.code, map: result.map};
    },
  };
};
