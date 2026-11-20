import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { onlyExportComponents } from "./only-export-components.js";

let projectDirectory: string;

beforeEach(() => {
  projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-next-refresh-"));
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({ name: "preview", dependencies: { next: "16.0.0", react: "19.0.0" } }),
  );
});

afterEach(() => {
  resetFilesystemCaches();
  fs.rmSync(projectDirectory, { recursive: true, force: true });
});

const componentSource = `
import type { ReactNode } from "react";
export const Heading = () => <h2>Preview</h2>;
export function Preview({ choices, keyName }: { choices: Record<string, ReactNode>; keyName: string }) {
  return choices[keyName] ?? null;
}
`;

const pageSource = `
import { Preview as PreviewPanel } from "./preview";
export default function Page() {
  return <PreviewPanel choices={{ current: <div /> }} keyName="current" />;
}
`;

const writeFixture = (relativePath: string, source: string): string => {
  const filename = path.join(projectDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};

const scan = (filename: string, source = componentSource) => {
  resetFilesystemCaches();
  const result = runRule(onlyExportComponents, source, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("only-export-components Next App Router page imports", () => {
  it("updates when the aliased JSX import is added, edited, or removed", () => {
    const filename = writeFixture("src/app/view/preview.tsx", componentSource);
    expect(scan(filename)).toHaveLength(1);

    const pageFilename = writeFixture("src/app/view/page.tsx", pageSource);
    expect(scan(filename)).toEqual([]);

    fs.writeFileSync(
      pageFilename,
      pageSource.replace(
        '<PreviewPanel choices={{ current: <div /> }} keyName="current" />',
        "PreviewPanel({ choices: {}, keyName: 'current' })",
      ),
    );
    expect(scan(filename)).toHaveLength(1);
    fs.writeFileSync(pageFilename, pageSource);
    expect(scan(filename)).toEqual([]);

    fs.unlinkSync(pageFilename);
    expect(scan(filename)).toHaveLength(1);
  });

  it("retains the warning if a competing extension appears", () => {
    const filename = writeFixture("app/view/preview.tsx", componentSource);
    writeFixture("app/view/page.tsx", pageSource);
    expect(scan(filename)).toEqual([]);

    const competitor = writeFixture("app/view/preview.ts", "export const Preview = () => null;");
    expect(scan(filename)).toHaveLength(1);

    fs.unlinkSync(competitor);
    expect(scan(filename)).toEqual([]);
  });

  it.each([
    componentSource + "\nPreview = replacement;\n",
    componentSource.replace("  return choices", "  Preview = replacement;\n  return choices"),
  ])("retains a warning when the exported binding is reassigned", (source) => {
    const filename = writeFixture("app/view/preview.tsx", source);
    writeFixture("app/view/page.tsx", pageSource);
    expect(scan(filename, source)).toHaveLength(1);
  });

  it.each([
    pageSource.replace("import {", "import type {"),
    pageSource.replace("{ Preview as", "{ type Preview as"),
    pageSource.replace("export default", "export"),
    pageSource.replace("  return", "  const PreviewPanel = () => <main />;\n  return"),
  ])("retains the warning without a runtime JSX import in a route page", (page) => {
    const filename = writeFixture("app/view/preview.tsx", componentSource);
    writeFixture("app/view/page.tsx", page);
    expect(scan(filename)).toHaveLength(1);
  });

  it.each(["components/view", "src/app/_private/view"])(
    "retains a warning outside the App Router at %s",
    (directory) => {
      const filename = writeFixture(`${directory}/preview.tsx`, componentSource);
      writeFixture(`${directory}/page.tsx`, pageSource);
      expect(scan(filename)).toHaveLength(1);
    },
  );
});
