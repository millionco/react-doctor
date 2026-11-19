import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const RULE_ID = "no-ref-current-in-render";
// Authored source-only project; no runtime archive files are copied or executed.
const SOURCE = `import React from "react";
import { sharedClient } from "./cache";
export function useCachedClient() {
  const slot = React.useRef<typeof sharedClient>(null);
  if (!slot.current) {
    slot.current = sharedClient;
  }
  return slot.current;
}
`;
const MANIFEST = {
  private: true,
  packageManager: "yarn@1.22.22",
  scripts: { dev: "next dev", build: "next build" },
  dependencies: {
    next: "15.2.4",
    react: "^19.0.0",
    "@tanstack/react-query": "^5.71.10",
    "next-intl": "^4.0.2",
  },
};
// Independently authored minimal Yarn v1 metadata fixture. These are public
// artifact identities, not a copied project lock or a transitive install graph.
const YARN_LOCK = `# yarn lockfile v1

"@tanstack/react-query@^5.71.10":
  version "5.71.10"
  resolved "https://registry.yarnpkg.com/@tanstack/react-query/-/react-query-5.71.10.tgz#940d485a499b86aaa37764e26709ed79b393fe29"
  integrity sha512-mQYM/ObpL8YMDz8vCoUuHkbe8Yu7NnVRH8aBaBa/3zlufjp1f1VuWjeO3TcumNHfuVMDwEAGinsgwrB7OKADiQ==
  dependencies:
    "@tanstack/query-core" "5.71.10"

"@tanstack/query-core@5.71.10":
  version "5.71.10"
  resolved "https://registry.yarnpkg.com/@tanstack/query-core/-/query-core-5.71.10.tgz#1f2dc5abf595156e7d9c5d6e4f47e805a7083c30"
  integrity sha512-/fKEY8fO1nbszfrBatzmhJa1nEwIKn0c6Tv2A1ocSA5OiD2GukOIV8nnBbvJRgZb/VIoBy9/N4PVbABI8YQLow==

"next-intl@^4.0.2":
  version "4.0.2"
  resolved "https://registry.yarnpkg.com/next-intl/-/next-intl-4.0.2.tgz#952cb392e441c4feedc78d158a27c5d3c1d24991"
  integrity sha512-3cKVflwdrqxCOvAL+DtGN68qR802i0PEj0dttkAD5IK5XxOjugQs4yU8aSakvPMbkOrhEJ+89z5lG2EAqi7Gkw==

"next@15.2.4":
  version "15.2.4"
  resolved "https://registry.yarnpkg.com/next/-/next-15.2.4.tgz#e05225e9511df98e3b2edc713e17f4c970bff961"
  integrity sha512-VwL+LAaPSxEkd3lU2xWbgEOtrM8oedmyhBqaVNmgKB+GvZlCy9rgaEc+y2on0wv+l0oSFqLtYD6dcC1eAedUaQ==

"react@^19.0.0":
  version "19.1.0"
  resolved "https://registry.yarnpkg.com/react/-/react-19.1.0.tgz#926864b6c48da7627f004795d6cce50e90793b75"
  integrity sha512-FS+XFBNvn3GTAWq26joslQgWNoFu08F4kl0J4CgdNKADkdSGXQyTCnKteIAJy96Br6YbpEU1LSzV5dYtjMkMDg==
`;

let directory: string;
let filename: string;
const write = (relative: string, text: string) => {
  const destination = path.join(directory, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, text);
};
const inspect = (source = SOURCE) => {
  // Changes are observed at a new scan epoch, matching filesystem-cache policy.
  resetFilesystemCaches();
  const result = runRule(noRefCurrentInRender, source, { filename, includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};
const expectGuardedWriteWarning = (source = SOURCE) => {
  const start = source.indexOf("    slot.current = sharedClient;");
  expect(start).toBeGreaterThanOrEqual(0);
  const line = source.slice(0, start).split("\n").length;
  expect(inspect(source).some((diagnostic) => diagnostic.line === line)).toBe(true);
};

beforeEach(() => {
  resetFilesystemCaches();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-locked-query-ref-"));
  filename = path.join(directory, "src", "client.tsx");
  write("src/client.tsx", SOURCE);
  write("package.json", JSON.stringify(MANIFEST));
  write("yarn.lock", YARN_LOCK);
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler" } }),
  );
  write(
    "next.config.ts",
    `import type { NextConfig } from "next";
import makeIntl from "next-intl/plugin";
const wrap = makeIntl("./src/localization/request.ts");
const config: NextConfig = { output: "standalone" };
export default wrap(config);
`,
  );
  write("src/localization/request.ts", "export default {};\n");
  write("src/policy.ts", "export const policy = { retry: false, staleTime: 900 };\n");
  write(
    "src/cache.ts",
    `import { QueryClient } from "@tanstack/react-query";
import { policy } from "./policy";
const sharedClient = new QueryClient({ defaultOptions: { queries: policy } });
export { sharedClient };
`,
  );
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("locked QueryClient private ref initialization", () => {
  it("accepts the closed source-checkout configuration", () => {
    expect(inspect()).toEqual([]);
  });

  it("retains the warning after a visible React default mutation", () => {
    expectGuardedWriteWarning(
      SOURCE.replace("export function", "React.useRef = replacement;\nexport function"),
    );
  });

  it("retains the guarded write when a competing ref write exists", () => {
    expectGuardedWriteWarning(
      SOURCE.replace("  return slot.current;", "  slot.current = null;\n  return slot.current;"),
    );
  });

  it("invalidates qualification for changed package metadata and lock integrity", () => {
    expect(inspect()).toEqual([]);
    write("package.json", JSON.stringify({ ...MANIFEST, resolutions: { react: "other" } }));
    expectGuardedWriteWarning();
    write("package.json", JSON.stringify(MANIFEST));
    expect(inspect()).toEqual([]);
    write("yarn.lock", YARN_LOCK.replace("sha512-mQYM/", "sha512-invalid/"));
    expectGuardedWriteWarning();
  });

  it("records metadata, source and alternate-extension cache probes", () => {
    resetFilesystemCaches();
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: SOURCE,
      ruleIds: [RULE_ID],
    });
    for (const relative of [
      "package.json",
      "yarn.lock",
      "tsconfig.json",
      "next.config.ts",
      "src/cache.ts",
      "src/policy.ts",
    ]) {
      expect(trace?.contentPaths.has(normalizeFilename(path.join(directory, relative)))).toBe(true);
    }
    expect(trace?.existencePaths.has(normalizeFilename(path.join(directory, "src/cache.js")))).toBe(
      true,
    );
    expect(trace?.existencePaths.has(normalizeFilename(path.join(directory, ".babelrc")))).toBe(
      true,
    );
    write("src/cache.js", "export const sharedClient = {};\n");
    expectGuardedWriteWarning();
  });
});
