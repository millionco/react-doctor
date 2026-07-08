import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBarrelImport } from "./no-barrel-import.js";

describe("bundle-size/no-barrel-import — regressions", () => {
  let temporaryDirectory = "";
  let sourceDirectory = "";

  const writeModule = (relativePath: string, contents: string): void => {
    const absolutePath = path.join(sourceDirectory, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
  };

  const runOnFile = (relativeFilename: string, code: string) =>
    runRule(noBarrelImport, code, {
      filename: path.join(sourceDirectory, relativeFilename),
    });

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-no-barrel-import-regr-"));
    sourceDirectory = path.join(temporaryDirectory, "src");
    writeModule(
      "components/Button.tsx",
      "export const Button = () => null;\nexport interface ButtonProps { label: string }\n",
    );
    writeModule("components/Card.tsx", "export const Card = () => null;\n");
    writeModule(
      "components/index.ts",
      "export { Button } from './Button';\nexport type { ButtonProps } from './Button';\nexport { Card } from './Card';\n",
    );
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("does not flag an import whose binding is used only in a type position", () => {
    const result = runOnFile(
      "App.tsx",
      `import { ButtonProps } from "./components";
const props: ButtonProps = { label: "x" };
void props;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an import type declaration", () => {
    const result = runOnFile(
      "App.tsx",
      `import type { ButtonProps } from "./components";
const props: ButtonProps = { label: "x" };
void props;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when every specifier is an inline type specifier", () => {
    const result = runOnFile(
      "App.tsx",
      `import { type ButtonProps } from "./components";
const props: ButtonProps = { label: "x" };
void props;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an unused import binding", () => {
    const result = runOnFile(
      "App.tsx",
      `import { Button } from "./components";
export const answer = 42;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag imports inside a .d.ts declaration file", () => {
    const result = runOnFile(
      "types.d.ts",
      `import { Button } from "./components";
export declare const app: typeof Button;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag imports inside a server-only .server.ts module", () => {
    const result = runOnFile(
      "loader.server.ts",
      `import { Button } from "./components";
void Button;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a deliberate whole-barrel namespace import", () => {
    const result = runOnFile(
      "attach.ts",
      `import * as components from "./components";
Object.assign(globalThis, components);
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an import consuming every runtime export of the barrel", () => {
    const result = runOnFile(
      "App.tsx",
      `import { Button, Card } from "./components";
void Button;
void Card;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single-source pass-through index", () => {
    writeModule("text-field/text-field.tsx", "export const TextField = () => null;\n");
    writeModule(
      "text-field/index.ts",
      "export * from './text-field';\nexport { TextField as default } from './text-field';\n",
    );

    const result = runOnFile(
      "App.tsx",
      `import { TextField } from "./text-field";
void TextField;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a runtime import referenced in an expression", () => {
    const result = runOnFile(
      "App.tsx",
      `import { Button } from "./components";
void Button;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a runtime import used only as a JSX element", () => {
    const result = runOnFile(
      "App.tsx",
      `import { Button } from "./components";
export const App = () => <Button />;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a runtime import used as a JSX member-expression root", () => {
    writeModule("components/Menu.tsx", "const Item = () => null;\nexport const Menu = { Item };\n");
    writeModule(
      "components/index.ts",
      "export { Button } from './Button';\nexport { Card } from './Card';\nexport { Menu } from './Menu';\n",
    );

    const result = runOnFile(
      "App.tsx",
      `import { Menu } from "./components";
export const App = () => <Menu.Item />;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a runtime import referenced only inside a nested function", () => {
    const result = runOnFile(
      "App.tsx",
      `import { Card } from "./components";
export const makeCard = () => Card;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // Delta-verify new FP (Automattic vip-design-system src/system/index.ts):
  // the package's own public barrel imports members from child barrels only
  // to re-export them for the library entry — consumers pull the same module
  // graph either way, so direct-source imports save nothing.
  it("does not flag a barrel import inside the package's own aggregation barrel", () => {
    const result = runOnFile(
      "index.ts",
      `import { Button, Card } from "./components";
import { Flex } from "./Flex";
export { Button, Card, Flex };
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a file that re-exports barrel imports but also uses them at runtime", () => {
    const result = runOnFile(
      "index.tsx",
      `import { Button } from "./components";
export { Button };
export const App = () => <Button />;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a mixed import when the value specifier is used at runtime", () => {
    const result = runOnFile(
      "App.tsx",
      `import { Button, type ButtonProps } from "./components";
const render = (props: ButtonProps) => Button(props);
void render;
`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
