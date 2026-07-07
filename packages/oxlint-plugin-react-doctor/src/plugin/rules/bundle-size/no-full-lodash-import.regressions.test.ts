import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { noFullLodashImport } from "./no-full-lodash-import.js";

const expectFail = (code: string): void => {
  const result = runRule(noFullLodashImport, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noFullLodashImport, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("bundle-size/no-full-lodash-import — regressions", () => {
  it("flags a runtime default import of lodash", () => {
    expectFail(`
      import _ from "lodash";
      export const chunked = _.chunk([1, 2, 3], 2);
    `);
  });

  it("flags a runtime named import of lodash", () => {
    expectFail(`
      import { debounce } from "lodash";
      export const debounced = debounce(() => {}, 100);
    `);
  });

  it("does not flag a type-only import from lodash", () => {
    expectPass(`import type { Dictionary } from "lodash";`);
  });

  // Verify wave: Node-only framework/CLI code (gatsby internals, build
  // tooling) has no user-facing bundle for the full lodash import to bloat.
  it("stays silent in a file importing node builtins", () => {
    expectPass(`
      import { isEqual } from "lodash";
      import * as fs from "fs-extra";
      export const didChange = (statePath: string, next: object) =>
        !isEqual(JSON.parse(fs.readFileSync(statePath, "utf-8")), next);
    `);
  });

  it("stays silent in a file using process.cwd()", () => {
    expectPass(`
      import { get } from "lodash";
      export const readFlag = (config: object) => get(config, ["flags", process.cwd()]);
    `);
  });

  // Verify wave: bindings used only in type positions are erased at emit.
  it("stays silent when lodash bindings are used only as types", () => {
    expectPass(`
      import { DebouncedFunc } from "lodash";
      export const track = (fn: DebouncedFunc<() => void>) => fn;
    `);
  });

  // Verify wave: Next.js strips server data functions — and imports used
  // only inside them — from the client bundle.
  it("stays silent when lodash is used only inside getStaticPaths", () => {
    expectPass(`
      import { flatten } from "lodash";
      export const getStaticPaths = async () => {
        const groups = [["a"], ["b"]];
        return { paths: flatten(groups), fallback: false };
      };
      export default function Page() {
        return <div>page</div>;
      }
    `);
  });

  it("still flags when lodash is also used in the component body", () => {
    expectFail(`
      import { flatten } from "lodash";
      export const getStaticPaths = async () => ({ paths: [], fallback: false });
      export default function Page({ rows }: { rows: string[][] }) {
        return <div>{flatten(rows).join(",")}</div>;
      }
    `);
  });

  // Verify wave: `pages/*.page.tsx` inside a published component library are
  // dev/screenshot-test pages never shipped to consumers (cloudscape).
  describe("library dev pages", () => {
    let temporaryDirectory: string;

    beforeEach(() => {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-lodash-devpage-"));
      resetManifestCaches();
    });

    afterEach(() => {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      resetManifestCaches();
    });

    const writeFixtureFile = (relativePath: string, contents: string): string => {
      const absolutePath = path.join(temporaryDirectory, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents, "utf8");
      return absolutePath;
    };

    const devPageCode = `
      import { range } from "lodash";
      export default function AsyncPage() {
        return <div>{range(50).join(",")}</div>;
      }
    `;

    it("does not flag a *.page.tsx dev page inside a published library", () => {
      writeFixtureFile(
        "package.json",
        `{ "name": "@scope/components", "peerDependencies": { "react": "^18.0.0" } }`,
      );
      const filename = writeFixtureFile("pages/autosuggest/async.page.tsx", devPageCode);
      const result = runRule(noFullLodashImport, devPageCode, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a *.page.tsx file inside a private app (pageExtensions)", () => {
      writeFixtureFile(
        "package.json",
        `{ "name": "my-app", "private": true, "dependencies": { "react": "^18.0.0", "next": "^14.0.0" } }`,
      );
      const filename = writeFixtureFile("pages/dashboard/index.page.tsx", devPageCode);
      const result = runRule(noFullLodashImport, devPageCode, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("still flags library source files that are not dev pages", () => {
      writeFixtureFile(
        "package.json",
        `{ "name": "@scope/components", "peerDependencies": { "react": "^18.0.0" } }`,
      );
      const filename = writeFixtureFile("src/autosuggest/index.tsx", devPageCode);
      const result = runRule(noFullLodashImport, devPageCode, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });
});
