import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { htmlLabelHasSingleControl } from "./html-label-has-single-control.js";
const walkAstCounter = vi.hoisted(() => vi.fn());

vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: walkAstCounter.mockImplementation(originalModule.walkAst),
  };
});

const assignmentTargetCounter = vi.hoisted(() => vi.fn());

vi.mock("../../utils/is-within-assignment-target.js", async (importOriginal) => {
  const originalModule =
    await importOriginal<typeof import("../../utils/is-within-assignment-target.js")>();
  return {
    ...originalModule,
    isWithinAssignmentTarget: assignmentTargetCounter.mockImplementation(
      originalModule.isWithinAssignmentTarget,
    ),
  };
});

interface ImportedButtonCase {
  name: string;
  code: string;
  buttonCode: string;
  expectedCount: number;
  extraSources?: Record<string, string>;
}
const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
const cases: ImportedButtonCase[] = [
  {
    name: "runtime-binding-unmasked",
    code: 'import {Button} from "./button";import {mutate} from "./external";function expose(){mutate(Button);}expose();export const View=()=> <label><input/><Button><span>Pick</span></Button></label>;',
    expectedCount: 0,
    buttonCode:
      'import {Slot} from "@radix-ui/react-slot";export const Button=({asChild=false,...props})=>{const Host=asChild?Slot:"button";return <Host {...props}/>;};',
  },
  {
    name: "runtime-binding-interface",
    code: 'import {Button} from "./button";import {mutate} from "./external";function expose(){interface Button {}mutate(Button);}expose();export const View=()=> <label><input/><Button><span>Pick</span></Button></label>;',
    expectedCount: 0,
    buttonCode:
      'import {Slot} from "@radix-ui/react-slot";export const Button=({asChild=false,...props})=>{const Host=asChild?Slot:"button";return <Host {...props}/>;};',
  },
  {
    name: "runtime-binding-type-alias",
    code: 'import {Button} from "./button";import {mutate} from "./external";function expose(){type Button=unknown;mutate(Button);}expose();export const View=()=> <label><input/><Button><span>Pick</span></Button></label>;',
    expectedCount: 0,
    buttonCode:
      'import {Slot} from "@radix-ui/react-slot";export const Button=({asChild=false,...props})=>{const Host=asChild?Slot:"button";return <Host {...props}/>;};',
  },
  {
    name: "runtime-binding-real-local-interface",
    code: 'import {Button} from "./button";import {mutate} from "./external";function expose(){const Button=()=>null;interface Button {}mutate(Button);}expose();export const View=()=> <label><input/><Button><span>Pick</span></Button></label>;',
    expectedCount: 1,
    buttonCode:
      'import {Slot} from "@radix-ui/react-slot";export const Button=({asChild=false,...props})=>{const Host=asChild?Slot:"button";return <Host {...props}/>;};',
  },

  {
    name: "consumer-require-provider-escape",
    code: 'import { Button } from "./button"; const controls = require("./button"); controls.Button.defaultProps = { asChild: true }; export const Example = () => <label><input /><Button><span>Pick</span></Button></label>;',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot"; export const Button = ({ asChild = false, ...props }) => { const Host = asChild ? Slot : "button"; return <Host {...props} />; };',
    expectedCount: 0,
  },
  {
    name: "consumer-require-alias-provider-escape",
    code: 'import { Button } from "./button"; const load = require; const controls = load("./button"); controls.Button.defaultProps = { asChild: true }; export const Example = () => <label><input /><Button><span>Pick</span></Button></label>;',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot"; export const Button = ({ asChild = false, ...props }) => { const Host = asChild ? Slot : "button"; return <Host {...props} />; };',
    expectedCount: 0,
  },
  {
    name: "consumer-dynamic-import-provider-escape",
    code: 'import { Button } from "./button"; import("./button").then(controls => { controls.Button.defaultProps = { asChild: true }; }); export const Example = () => <label><input /><Button><span>Pick</span></Button></label>;',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot"; export const Button = ({ asChild = false, ...props }) => { const Host = asChild ? Slot : "button"; return <Host {...props} />; };',
    expectedCount: 0,
  },
  {
    name: "provider-dynamic-self-import-escape",
    code: 'import { Button } from "./button";  export const Example = () => <label><input /><Button><span>Pick</span></Button></label>;',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot"; export const Button = ({ asChild = false, ...props }) => { const Host = asChild ? Slot : "button"; return <Host {...props} />; };import("./button").then(controls => { controls.Button.defaultProps = { asChild: true }; });',
    expectedCount: 0,
  },
  {
    name: "local-loader-outside-static-profile",
    code: 'import { Button } from "./button"; const require = () => ({ Button: () => <span /> }); void require; export const Example = () => <label><input /><Button /></label>;',
    buttonCode: "export const Button = () => <button />;",
    expectedCount: 0,
    extraSources: { "format.ts": "export const format = (value) => value;" },
  },
  {
    name: "unrelated-static-import-preserves-proof",
    code: 'import { Button } from "./button"; import { format } from "./format"; void format; export const Example = () => <label><input /><Button /></label>;',
    buttonCode: "export const Button = () => <button />;",
    expectedCount: 1,
    extraSources: { "format.ts": "export const format = (value) => value;" },
  },
  {
    name: "file-input-and-default-button",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 1,
  },
  {
    name: "css-hidden-file-remains-labelable",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" style={{display:"none"}} /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 1,
  },
  {
    name: "hidden-type-not-new-witness",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="hidden" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "single-imported-control",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "explicit-false-branch",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" /><Button asChild={false}>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 1,
  },
  {
    name: "slot-branch-unsupported",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" /><Button asChild={true}><span>Pick</span></Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "dynamic-branch-unsupported",
    code: 'import { Button } from "./button";\ndeclare const enabled: boolean;\nexport const Example = () => <label><input type="text" /><Button asChild={enabled}>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "consumer-spread-unsupported",
    code: 'import { Button } from "./button";\ndeclare const options: object;\nexport const Example = () => <label><input type="text" /><Button {...options}>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "external-component-unknown",
    code: 'import { Button } from "external-controls";\n\nexport const Example = () => <label><input type="text" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "direct-native-positive",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" /><button>Pick</button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 1,
  },
  {
    name: "plain-native-wrapper",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" /><Button>Pick</Button></label>;\n',
    buttonCode: "export const Button = (props: object) => <button {...props} />;\n",
    expectedCount: 1,
  },
  {
    name: "nonbutton-selected-branch",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "span";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "visible-provider-write",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\nButton.defaultProps = { asChild: true };\n',
    expectedCount: 0,
  },
  {
    name: "consumer-value-alias-unsupported",
    code: 'import { Button } from "./button";\nconst Alias = Button;\nexport const Example = () => <label><input type="text" /><Alias>Pick</Alias></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "unknown-ancestor-unsupported",
    code: 'import { Button } from "./button";\nconst Retain = ({children}: {children: unknown}) => null;\nexport const Example = () => <label><Retain><input type="text" /><Button>Pick</Button></Retain></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "selector-reassigned",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  let Host = asChild ? Slot : "button";\n  Host = Slot;\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "dynamic-input-type-not-witness",
    code: 'import { Button } from "./button";\ndeclare const kind: string;\nexport const Example = () => <label><input type={kind} /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "two-imported-controls-deferred",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><Button>First</Button><Button>Second</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "wrapper-alternative-return",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  if (asChild) return null;\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "expression-descendant-outside-profile",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="text" />{true && <Button>Pick</Button>}</label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "default-import-named-function",
    code: 'import Button from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      "export default function NativeAction(props: object) { return <button {...props} />; }\n",
    expectedCount: 1,
  },
  {
    name: "named-function-own-export",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      "function Button(props: object) { return <button {...props} />; }\nexport { Button };\n",
    expectedCount: 1,
  },
  {
    name: "native-and-fragment-ancestors",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><><span><input type="file" /></span><div><Button>Pick</Button></div></></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 1,
  },
  {
    name: "type-only-import-declaration",
    code: 'import type { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "type-only-import-specifier",
    code: 'import { type Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "duplicate-selected-imports",
    code: 'import { Button } from "./button";\nimport { Button as OtherButton } from "./button";\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "secondary-same-declaration-import",
    code: 'import { Button, Button as OtherButton } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "secondary-provider-value-escape",
    code: 'import { Button } from "./button";\nconst escaped = Button; void escaped;\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "named-function-self-call",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      "export function Button(props: object) { Button(props); return <button {...props} />; }\n",
    expectedCount: 0,
  },
  {
    name: "named-function-self-escape",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      "export function Button(props: object) { consume(Button); return <button {...props} />; }\n",
    expectedCount: 0,
  },
  {
    name: "named-function-self-jsx",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      "export function Button(props: object) { return <button {...props}><Button /></button>; }\n",
    expectedCount: 0,
  },
  {
    name: "parameter-pattern-write",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  [asChild] = [true];\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "parameter-loop-write",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  for (asChild of [true]) {}\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "selector-value-alias",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  const AliasedHost = Host; void AliasedHost;\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "duplicate-consumer-as-child",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button asChild={false} asChild={true}>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "consumer-eval-reference",
    code: 'import { Button } from "./button";\nvoid eval;\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "provider-eval-reference",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'void eval;\nimport { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "provider-runtime-enum",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'enum Stage { Ready = 0 }\nimport { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "ordinary-erased-interface",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'interface Marker { active: boolean }\nimport { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 1,
  },
  {
    name: "class-component-unsupported",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode: "export class Button { render() { return <button />; } }\n",
    expectedCount: 0,
  },
  {
    name: "hoc-call-unsupported",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode: "export const Button = wrap((props) => <button {...props} />);\n",
    expectedCount: 0,
  },
  {
    name: "forward-ref-unsupported",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { forwardRef } from "react";\nexport const Button = forwardRef((props, ref) => <button {...props} ref={ref} />);\n',
    expectedCount: 0,
  },
  {
    name: "barrel-routing-unsupported",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode: 'export { Button } from "./real-button";\n',
    expectedCount: 0,
    extraSources: {
      "real-button.tsx": "export const Button = () => <button />;\n",
    },
  },
  {
    name: "mutable-export-unsupported",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode: "export let Button = (props) => <button {...props} />;\n",
    expectedCount: 0,
  },
  {
    name: "false-default-required",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = true, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "input-spread-is-not-witness",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input {...options} type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "custom-ancestor-on-button-only",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Retain><Button>Pick</Button></Retain></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "consumer-polymorphic-prop",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button as="span">Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "selector-extra-parameter-read",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  void asChild;\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "duplicate-default-property",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, asChild: second = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
  {
    name: "duplicate-provider-declaration",
    code: 'import { Button } from "./button";\n\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      "function Button() { return <span />; }\nfunction Button() { return <button />; }\nexport { Button };\n",
    expectedCount: 0,
  },
  {
    name: "competing-consumer-import-binding",
    code: 'import { Button } from "./button";\nimport { Button } from "./other-button";\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
    extraSources: {
      "other-button.tsx": "export const Button = () => <button />;\n",
    },
  },
  {
    name: "secondary-provider-explicit-extension-alias",
    code: 'import { Button } from "./button";\nimport { Button as OtherButton } from "./button.tsx";\nOtherButton.defaultProps = { asChild: true };\nexport const Example = () => <label><input type="file" /><Button>Pick</Button></label>;\n',
    buttonCode:
      'import { Slot } from "@radix-ui/react-slot";\ninterface ButtonProps { asChild?: boolean; children?: unknown; }\nexport const Button = ({ asChild = false, ...props }: ButtonProps) => {\n  const Host = asChild ? Slot : "button";\n  return <Host data-role="action" {...props} />;\n};\n',
    expectedCount: 0,
  },
];
describe("local imported native button label provenance", () => {
  it("checks imported binding references once across native and polymorphic consumers", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-label-binding-work-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "view.tsx");
    const code = `import { Button } from "./button";
      export const Example = () => <>
        <label><input /><Button /></label>
        <label><input /><Button asChild={true}><span /></Button></label>
        <label><input /><Button /></label>
      </>;`;
    fs.writeFileSync(filename, code);
    fs.writeFileSync(
      path.join(directory, "button.tsx"),
      'import { Slot } from "@radix-ui/react-slot"; export const Button = ({ asChild = false, ...props }) => { const Host = asChild ? Slot : "button"; return <Host {...props} />; };',
    );
    resetModuleResolutionCaches();
    resetCrossFileExportCaches();
    assignmentTargetCounter.mockClear();
    const result = runRule(htmlLabelHasSingleControl, code, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(
      assignmentTargetCounter.mock.calls.filter(
        ([node]) => node.type === "JSXIdentifier" && node.name === "Button",
      ),
    ).toHaveLength(4);
  });

  it.each([
    { name: "supported", source: "" },
    { name: "unsupported", source: 'void import("./unknown");' },
  ])("walks a $name consumer program once across sibling labels", ({ source }) => {
    walkAstCounter.mockClear();
    const result = runRule(
      htmlLabelHasSingleControl,
      `${source} export const Example = () => <><label><input /></label><label><input /></label></>;`,
      { filename: "/tmp/rd-label-program-scaling/view.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(walkAstCounter.mock.calls.filter(([node]) => node.type === "Program")).toHaveLength(1);
  });

  it.each(cases)("$name", ({ code, buttonCode, expectedCount, extraSources }) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-label-native-button-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "view.tsx");
    fs.writeFileSync(filename, code);
    fs.writeFileSync(path.join(directory, "button.tsx"), buttonCode);
    for (const [relative, source] of Object.entries(extraSources ?? {}))
      fs.writeFileSync(path.join(directory, relative), source);
    resetModuleResolutionCaches();
    resetCrossFileExportCaches();
    const result = runRule(htmlLabelHasSingleControl, code, {
      filename,
      forceJsx: false,
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
