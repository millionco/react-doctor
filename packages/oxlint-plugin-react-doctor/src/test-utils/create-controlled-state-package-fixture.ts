import * as fs from "node:fs";
import * as path from "node:path";

export interface ControlledPackageFixture {
  main?: string;
  module?: string;
  esmHook?: string;
  commonjsHook?: string;
  commonjsEntry?: string;
  packageOverrides?: Record<string, unknown>;
  consumerManifest?: Record<string, unknown>;
}

export const CONTROLLED_STATE_ESM_HOOK = `import { useState as createState } from "react";
const controlledState = (initial, controlled) => {
  const [localValue, updateValue] = createState(initial);
  const currentValue = controlled === undefined ? localValue : controlled;
  return [currentValue, updateValue];
}; export default controlledState;`;
export const CONTROLLED_STATE_COMMONJS_HOOK = `Object.defineProperty(exports, "__esModule", { value: true });
const stateProvider = require("react");
const controlledState = (initial, controlled) => {
  const [localValue, updateValue] = (0, stateProvider.useState)(initial);
  const currentValue = controlled === undefined ? localValue : controlled;
  return [currentValue, updateValue];
}; exports.default = controlledState;`;
export const CONTROLLED_STATE_COMMONJS_ENTRY = `Object.defineProperty(exports, "useControlledState", {
  enumerable: true, get: () => stateHook.default,
});
const projectDefault = moduleValue => moduleValue && moduleValue.__esModule ? moduleValue : { default: moduleValue };
const stateHook = projectDefault(require("./bound-state"));`;

export const createControlledStatePackageFixture = (
  directory: string,
  fixture: ControlledPackageFixture = {},
): void => {
  const writeFile = (relativePath: string, source: string): void => {
    const filename = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source);
  };
  writeFile(
    "package.json",
    JSON.stringify(
      fixture.consumerManifest ?? {
        name: "synthetic-control",
        dependencies: { react: "^18.0.0", "@rc-component/util": "^1.13.0" },
      },
    ),
  );
  const packageRoot = "node_modules/@rc-component/util/";
  writeFile(
    packageRoot + "package.json",
    JSON.stringify({
      name: "@rc-component/util",
      version: "1.13.0",
      main: fixture.main ?? "./lib/index",
      module: fixture.module ?? "./es/index",
      ...fixture.packageOverrides,
    }),
  );
  writeFile(
    packageRoot + "es/index.js",
    `export { default as useControlledState } from "./bound-state";`,
  );
  writeFile(packageRoot + "es/bound-state.js", fixture.esmHook ?? CONTROLLED_STATE_ESM_HOOK);
  writeFile(packageRoot + "lib/index.js", fixture.commonjsEntry ?? CONTROLLED_STATE_COMMONJS_ENTRY);
  writeFile(
    packageRoot + "lib/bound-state.js",
    fixture.commonjsHook ?? CONTROLLED_STATE_COMMONJS_HOOK,
  );
};
