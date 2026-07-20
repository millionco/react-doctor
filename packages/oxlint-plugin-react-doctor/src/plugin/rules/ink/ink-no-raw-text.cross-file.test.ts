import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { inkNoRawText } from "./ink-no-raw-text.js";

let temporaryDirectory = "";
let entryFilename = "";

const writeSource = (relativePath: string, source: string): void => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, source);
};

beforeAll(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-ink-raw-text-"));
  entryFilename = path.join(temporaryDirectory, "app.tsx");
});

afterAll(() => {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true });
});

describe("ink-no-raw-text cross-file wrappers", () => {
  it("reports raw text forwarded into an imported Ink Box", () => {
    writeSource(
      "panel.tsx",
      `import {Box} from "ink"; export const Panel=({children}) => <Box>{children}</Box>;`,
    );
    const code = `import {Panel} from "./panel"; const App=()=> <Panel>bad</Panel>;`;
    expect(runRule(inkNoRawText, code, { filename: entryFilename }).diagnostics).toHaveLength(1);
  });

  it("accepts raw text forwarded into an imported Ink Text", () => {
    writeSource(
      "label.tsx",
      `import {Text} from "ink"; export const Label=({children}) => <Text>{children}</Text>;`,
    );
    const code = `import {Label} from "./label"; const App=()=> <Label>good</Label>;`;
    expect(runRule(inkNoRawText, code, { filename: entryFilename }).diagnostics).toHaveLength(0);
  });

  it("resolves a first-party wrapper chain within the imported module", () => {
    writeSource(
      "layout.tsx",
      `import {Box} from "ink"; const Inner=({children}) => <Box>{children}</Box>; export const Layout=({children}) => <Inner>{children}</Inner>;`,
    );
    const code = `import {Layout} from "./layout"; const App=()=> <Layout>bad</Layout>;`;
    expect(runRule(inkNoRawText, code, { filename: entryFilename }).diagnostics).toHaveLength(1);
  });

  it("does not reuse an imported wrapper result for a shadowed component", () => {
    writeSource(
      "panel.tsx",
      `import {Box} from "ink"; export const Panel=({children}) => <Box>{children}</Box>;`,
    );
    const code = `
      import {Panel} from "./panel";
      import {Text} from "ink";
      const Unsafe=()=> <Panel>bad</Panel>;
      const Safe=(Panel)=> <Panel>good</Panel>;
    `;
    expect(runRule(inkNoRawText, code, { filename: entryFilename }).diagnostics).toHaveLength(1);
  });
});
