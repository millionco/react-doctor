import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { rnNoDeprecatedModules } from "./rn-no-deprecated-modules.js";

let temporaryDirectory = "";
const checkImport = (moduleName: string, declaredVersion: string, installedVersion?: string) => {
  fs.writeFileSync(
    path.join(temporaryDirectory, "package.json"),
    JSON.stringify({ dependencies: { "react-native": declaredVersion } }),
  );
  if (installedVersion) {
    const packageDirectory = path.join(temporaryDirectory, "node_modules", "react-native");
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({ name: "react-native", version: installedVersion }),
    );
  }
  return runRule(rnNoDeprecatedModules, `import { ${moduleName} } from 'react-native';`, {
    filename: path.join(temporaryDirectory, "app.tsx"),
  });
};

describe("removed React Native export versions", () => {
  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-native-exports-"));
    resetManifestCaches();
  });
  afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  it.each([
    ["AsyncStorage", "^0.40.0"],
    ["AsyncStorage", "0.41.2"],
    ["AsyncStorage", "0.50.3"],
    ["AsyncStorage", "0.70.0"],
    ["WebView", "0.55.4"],
    ["WebView", "0.59.10"],
    ["WebView", "~0.59.0"],
    ["WebView", "0.59.x"],
  ])("accepts %s before removal in %s", (moduleName, version) => {
    expect(checkImport(moduleName, version).diagnostics).toHaveLength(0);
  });

  it.each([
    ["AsyncStorage", "0.71.0"],
    ["WebView", "0.60.0"],
    ["WebView", ">=0.55.0"],
    ["AsyncStorage", "0.55.0 || 0.71.0"],
  ])("reports %s once removed in %s", (moduleName, version) => {
    expect(checkImport(moduleName, version).diagnostics).toHaveLength(1);
  });

  it("uses the installed version instead of an older declaration", () => {
    expect(checkImport("AsyncStorage", "0.40.0", "0.71.0").diagnostics).toHaveLength(1);
  });
  it("uses the installed version instead of a newer declaration", () => {
    expect(checkImport("AsyncStorage", "0.71.0", "0.41.2").diagnostics).toHaveLength(0);
  });
});
