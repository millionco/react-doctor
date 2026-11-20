import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

const VITE_CONFIGURATION = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], build: { chunkSizeWarningLimit: 1000 } });`;
const PACKAGE_MANIFEST = {
  type: "module",
  scripts: { dev: "vite", build: "vite build" },
  dependencies: { react: "^18.3.1" },
  devDependencies: { vite: "^4.5.0", "@vitejs/plugin-react": "^4.3.0" },
};
const ASYNC_PROVIDER = 'export async function savePreference() { return fetch("/preferences"); }';
const CLOSED_CATCH = 'console.log("Save failed"); setNotice("Retry");';

const consumer = (catchBody = CLOSED_CATCH, initialize = "") =>
  `import { useState } from "react";
   import { savePreference } from "./save-preference";
   ${initialize}
   export function Preferences() {
     const [busy, setBusy] = useState(false);
     const [notice, setNotice] = useState("");
     const submit = async () => {
       setBusy(true);
       await savePreference().then(() => setNotice("Saved")).catch(() => { ${catchBody} });
       setBusy(false);
     };
     return <button type="button" disabled={busy} onClick={submit}>{notice}</button>;
   }`;

describe("settled loading flags in a stock Vite project", () => {
  let directory = "";

  const writeFile = (name: string, contents: string): string => {
    const filename = path.join(directory, name);
    fs.writeFileSync(filename, contents, "utf8");
    return filename;
  };

  beforeEach(() => {
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rd-terminal-catch-")));
    __clearParseSourceFileCacheForTests();
    resetManifestCaches();
    resetModuleResolutionCaches();
    writeFile("package.json", JSON.stringify(PACKAGE_MANIFEST));
    writeFile("vite.config.js", VITE_CONFIGURATION);
    writeFile("save-preference.js", ASYNC_PROVIDER);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const report = (source: string) => {
    const filename = writeFile("preferences.tsx", source);
    const result = runRule(noLoadingFlagResetOutsideFinally, source, { filename });
    expect(result.parseErrors).toEqual([]);
    return result.diagnostics;
  };

  it("accepts a native terminal catch that logs and updates a local React state", () => {
    expect(report(consumer())).toHaveLength(0);
  });

  it.each([
    'throw new Error("Unable to recover");',
    'return Promise.reject(new Error("Unable to recover"));',
    "setNotice(getErrorMessage());",
    'notifyFailure(); setNotice("Retry");',
  ])("retains the warning if terminal catch work can reject: %s", (catchBody) => {
    expect(report(consumer(catchBody))).toHaveLength(1);
  });

  it("retains the warning when a synchronous producer may throw before attaching the catch", () => {
    writeFile(
      "save-preference.js",
      'export function savePreference() { throw Error("Unable to save"); }',
    );
    expect(report(consumer())).toHaveLength(1);
  });

  it("retains the warning when the project can redirect the imported producer", () => {
    writeFile(
      "vite.config.js",
      VITE_CONFIGURATION.replace(
        "plugins:",
        'resolve: { alias: [{ find: "./save-preference", replacement: "./fallback" }] }, plugins:',
      ),
    );
    expect(report(consumer())).toHaveLength(1);
  });

  it("retains the warning when a second extension competes with the async provider", () => {
    writeFile(
      "save-preference.mjs",
      'export function savePreference() { throw new Error("Unable to save"); }',
    );
    expect(report(consumer())).toHaveLength(1);
  });

  it("retains the warning when a prebuild script can rewrite the provider", () => {
    writeFile(
      "package.json",
      JSON.stringify({
        ...PACKAGE_MANIFEST,
        scripts: { ...PACKAGE_MANIFEST.scripts, prebuild: "node replace-provider.mjs" },
      }),
    );
    expect(report(consumer())).toHaveLength(1);
  });

  it("retains the warning when a native Promise prototype method is replaced indirectly", () => {
    expect(
      report(
        consumer(
          CLOSED_CATCH,
          `const prototype = (async () => undefined)().__proto__;
           prototype.__defineGetter__("catch", () => () => { throw Error("Unable to attach"); });`,
        ),
      ),
    ).toHaveLength(1);
  });

  it("retains the warning when the logging method is shadowed", () => {
    expect(
      report(consumer(CLOSED_CATCH, 'const console = { log() { throw Error("Cannot log"); } };')),
    ).toHaveLength(1);
  });
});
