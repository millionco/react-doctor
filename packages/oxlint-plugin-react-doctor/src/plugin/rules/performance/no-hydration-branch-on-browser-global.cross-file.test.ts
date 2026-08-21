import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noHydrationBranchOnBrowserGlobal } from "./no-hydration-branch-on-browser-global.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hydration-browser-helper-"));
  __clearParseSourceFileCacheForTests();
  resetTsconfigAliasCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const runConsumer = (source: string): ReturnType<typeof runRule> => {
  const consumerPath = writeFile("src/AnimatedBackgroundImage.tsx", source);
  return runRule(noHydrationBranchOnBrowserGlobal, source, { filename: consumerPath });
};

describe("no-hydration-branch-on-browser-global — imported helper provenance", () => {
  it.each([
    ["image on the server", "false"],
    ["video on the server", "true"],
  ])("reports a media capability branch with %s", (_, serverFallback) => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = (mime) => {
        if (typeof document === "undefined") return ${serverFallback};
        return document.createElement("video").canPlayType(mime) !== "";
      };`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime } from "./video-background-mime";
      const AnimatedBackgroundImage = ({ mime, src }) =>
        canPlayVideoBackgroundMime(mime) ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when an imported helper returns the same result on both runtimes", () => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = (mime) => {
        if (typeof document === "undefined") return false;
        document.createElement("video").canPlayType(mime);
        return false;
      };`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime } from "./video-background-mime";
      const AnimatedBackgroundImage = ({ mime, src }) =>
        canPlayVideoBackgroundMime(mime) ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not attribute imported provenance to a shadowing local helper", () => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = () =>
        typeof document !== "undefined";`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime as importedCapability } from "./video-background-mime";
      const canPlayVideoBackgroundMime = () => false;
      const AnimatedBackgroundImage = ({ src }) =>
        canPlayVideoBackgroundMime() ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an immutable argument statically disables the browser branch", () => {
    writeFile(
      "src/environment.ts",
      `export const isBrowser = (enabled) =>
        enabled && typeof document !== "undefined";`,
    );
    const result = runConsumer(`
      "use client";
      import { isBrowser } from "./environment";
      const isEnabled = false;
      const AnimatedBackgroundImage = () =>
        isBrowser(isEnabled) ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a caller browser predicate passed through an imported helper", () => {
    writeFile("src/environment.ts", `export const identity = (value) => value;`);
    const result = runConsumer(`
      "use client";
      import { identity } from "./environment";
      const AnimatedBackgroundImage = () =>
        identity(typeof window !== "undefined") ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
