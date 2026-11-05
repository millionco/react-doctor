import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoImgElement } from "./nextjs-no-img-element.js";

let temporaryDirectory: string;
const PACKAGE_PATH = "packages/guide";
const SOURCE_PATH = `${PACKAGE_PATH}/src/gallery.tsx`;
const DOCS_LINK_IMPORT = 'import DocsLink from "@docusaurus/Link";';
const GALLERY_SOURCE = `${DOCS_LINK_IMPORT}
const Gallery = () => <DocsLink to="/gallery"><div><img src="/sample.png" alt="" /></div></DocsLink>;`;

const writeFixture = (relativePath: string, content: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
  return filename;
};

const writePackage = (extraScripts: Record<string, string> = {}): void => {
  writeFixture(
    `${PACKAGE_PATH}/package.json`,
    JSON.stringify({
      dependencies: { "@docusaurus/core": "3.8.0", next: "catalog:" },
      scripts: { serve: "docusaurus serve", build: "node ./docs-build.cjs", ...extraScripts },
    }),
  );
};

const runGallery = (source: string) => {
  const result = runRule(nextjsNoImgElement, source, {
    filename: writeFixture(SOURCE_PATH, source),
    settings: { "react-doctor": { rootDirectory: temporaryDirectory } },
    includeLocations: true,
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

beforeEach(() => {
  temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "nextjs-docusaurus-image-")),
  );
  writePackage();
  writeFixture(`${PACKAGE_PATH}/docusaurus.config.ts`, "export default {};");
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("nextjs-no-img-element Docusaurus Link children", () => {
  it("suppresses only the owned image with an unrelated path and a simple inherited config", () => {
    writeFixture(
      `${PACKAGE_PATH}/tsconfig.json`,
      JSON.stringify({
        extends: "../shared-options.json",
        compilerOptions: { paths: { "@guide/*": ["./*"] } },
      }),
    );
    writeFixture(
      "packages/shared-options.json",
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    const source = `${GALLERY_SOURCE}\nconst Header = () => <img src="/retained.png" alt="" />;`;
    expect(runGallery(source).map((diagnostic) => diagnostic.line)).toEqual([
      source.split("\n").length,
    ]);
  });

  it.each([
    ["bare Next", "next"],
    ["explicit Next build", "bunx next build"],
  ])("retains the warning for %s", (_name, command) => {
    writePackage({ start: command });
    expect(runGallery(GALLERY_SOURCE)).toHaveLength(1);
  });

  it.each(["next.config.mjs", "src/next.config.mts"])(
    "retains the warning for %s",
    (configPath) => {
      writeFixture(`${PACKAGE_PATH}/${configPath}`, "export default {};");
      expect(runGallery(GALLERY_SOURCE)).toHaveLength(1);
    },
  );

  it("retains the warning for a same-file Next value import", () => {
    expect(runGallery(`import "next/navigation";\n${GALLERY_SOURCE}`)).toHaveLength(1);
  });

  it("retains the warning when the Docusaurus config is absent", () => {
    fs.rmSync(path.join(temporaryDirectory, PACKAGE_PATH, "docusaurus.config.ts"));
    expect(runGallery(GALLERY_SOURCE)).toHaveLength(1);
  });

  it("retains the warning for an ordinary Next package", () => {
    writeFixture(
      `${PACKAGE_PATH}/package.json`,
      JSON.stringify({ dependencies: { next: "16.0.0" }, scripts: { build: "next build" } }),
    );
    expect(runGallery(GALLERY_SOURCE.replace("@docusaurus/Link", "next/link"))).toHaveLength(1);
  });

  it.each([
    [
      "shadowed",
      `${DOCS_LINK_IMPORT}\nconst Gallery = (DocsLink) => <DocsLink><img src="/sample.png" /></DocsLink>;`,
    ],
    ["type-only", GALLERY_SOURCE.replace("import DocsLink", "import type DocsLink")],
    [
      "written",
      GALLERY_SOURCE.replace(DOCS_LINK_IMPORT, `${DOCS_LINK_IMPORT}\nDocsLink = fallback;`),
    ],
    [
      "indirect",
      `${DOCS_LINK_IMPORT}\nconst Gallery = () => <DocsLink><Panel><img src="/sample.png" /></Panel></DocsLink>;`,
    ],
    [
      "callback",
      `${DOCS_LINK_IMPORT}\nconst Gallery = () => <DocsLink>{() => <img src="/sample.png" />}</DocsLink>;`,
    ],
    [
      "prop",
      `${DOCS_LINK_IMPORT}\nconst Gallery = () => <DocsLink decoration={<img src="/sample.png" />} />;`,
    ],
  ])("retains the warning for a %s image or link", (_name, source) => {
    expect(runGallery(source)).toHaveLength(1);
  });

  it.each([
    ["direct remap", { compilerOptions: { paths: { "@docusaurus/*": ["./src/*"] } } }],
    ["unsupported array extends", { extends: ["../remapped.json"] }],
    ["inherited baseUrl", { extends: "../base-url.json", compilerOptions: { paths: {} } }],
    ["unresolved extends", { extends: "../missing.json" }],
  ])("retains the warning for %s", (_name, config) => {
    writeFixture(`${PACKAGE_PATH}/tsconfig.json`, JSON.stringify(config));
    writeFixture(
      "packages/remapped.json",
      JSON.stringify({ compilerOptions: { paths: { "@docusaurus/Link": ["./fake.tsx"] } } }),
    );
    writeFixture("packages/base-url.json", JSON.stringify({ compilerOptions: { baseUrl: "." } }));
    expect(runGallery(GALLERY_SOURCE)).toHaveLength(1);
  });
});
