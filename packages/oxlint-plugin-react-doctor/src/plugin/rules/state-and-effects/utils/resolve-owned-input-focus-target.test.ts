import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { runRule, runRuleOnParsedFixture } from "../../../../test-utils/run-rule.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import type { Rule } from "../../../utils/rule.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resetFilesystemCaches } from "../../../utils/reset-filesystem-caches.js";
import { resolveOwnedInputFocusTarget } from "./resolve-owned-input-focus-target.js";

interface OwnedInputFixtureCase {
  readonly name: string;
  readonly entry: string;
  readonly files: Readonly<Record<string, string>>;
  readonly package: Readonly<Record<string, unknown>>;
  readonly expected: number;
  readonly entryDirectory?: string;
  readonly checkRelativeFilename?: boolean;
}

const fixtureRoots: string[] = [];
const probeRule: Rule = {
  id: "owned-input-focus-target-probe",
  severity: "warn",
  create: (context) => ({
    VariableDeclarator: (node) => {
      if (
        !isNodeOfType(node, "VariableDeclarator") ||
        !isNodeOfType(node.id, "Identifier") ||
        node.id.name !== "focusTarget" ||
        !node.init
      )
        return;
      const opening = resolveOwnedInputFocusTarget(node.init, context);
      if (opening) context.report({ node: opening, message: "Owned native input" });
    },
  }),
};

const writeFixture = (fixture: OwnedInputFixtureCase): { root: string; filename: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owned-input-focus-"));
  fixtureRoots.push(root);
  for (const [relativePath, body] of Object.entries({
    "package.json": JSON.stringify(fixture.package),
    ...fixture.files,
  })) {
    const filename = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, body);
  }
  const filename = path.join(root, fixture.entryDirectory ?? "", "entry.tsx");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, fixture.entry);
  return { root, filename };
};

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  resetFilesystemCaches();
});

const BASE_SOURCE =
  'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n';
const BASE_HOSTS =
  'import styled from "styled-components";\nexport const Field = styled.input.attrs(({ theme, ...rest }) => ({ theme: { ...theme }, tone: "plain", ...rest }))``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n';
const BASE_BARREL = 'export { Field, Frame, Caption } from "./hosts";\n';
const BASE_FILES = { "barrel.js": BASE_BARREL, "hosts.js": BASE_HOSTS };
const BASE_PACKAGE = { dependencies: { react: "^18.2.0", "styled-components": "5.3.11" } };

const fixtureCases: OwnedInputFixtureCase[] = [
  {
    name: "absolute and relative React18 project filenames agree",
    entry: BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
    checkRelativeFilename: true,
  },
  {
    name: "absolute and relative React19 project filenames both refuse",
    entry: BASE_SOURCE,
    files: BASE_FILES,
    package: { ...BASE_PACKAGE, dependencies: { ...BASE_PACKAGE.dependencies, react: "19.0.0" } },
    expected: 0,
    checkRelativeFilename: true,
  },
  {
    name: "readonly imported input and native styled ancestors",
    entry: BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "transparent ref receiver and parenthesized returned JSX",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = ((fieldRef as typeof fieldRef)!).current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "parenthesized returned JSX",
    entry: BASE_SOURCE.replace(
      "<Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>",
      "(<Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>)",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "fixed label input child prefix",
    entry: BASE_SOURCE.replace("ieldRef.current", "rameRef.current?.children[1]"),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "text does not occupy element child index",
    entry: BASE_SOURCE.replace(
      "ieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}>",
      'rameRef.current.children[1];\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}>text {"label"}',
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "readonly target alias remains local",
    entry: BASE_SOURCE.replace(
      "if (focusTarget) focus",
      "const ownedTarget = focusTarget; if (ownedTarget) owned",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "unsupported ref initializer",
    entry: BASE_SOURCE.replace("null", "{ focus() {} }"),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ref current assignment",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  fieldRef.current = foreign; const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ref escapes to unknown consumer",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  publish(fieldRef); const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ancestor ref escapes",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  publish(frameRef); const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ancestor contains extracted",
    entry: BASE_SOURCE.replace(
      "() => frameRef.current?.contains(document.activeElement)",
      "frameRef.current.contains",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ancestor current method replacement",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  frameRef.current.contains = replacement; const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "local target method replacement",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    focusTarget.focus = replacement; if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "target escapes",
    entry: BASE_SOURCE.replace("if (focusTarget) focusTarget.focus(", "publish(focusTarget"),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "logical target transport escapes",
    entry: BASE_SOURCE.replace("if (focusTarget) focusTarget.focus(", "publish(focusTarget || {}"),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "mutable target alias",
    entry: BASE_SOURCE.replace(
      "const focusTarget = fieldRef.current",
      "let focusTarget = fieldRef.current; focusTarget = foreign",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "duplicate ref publication",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption ref={fieldRef}>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "duplicate ancestor ref publication",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption ref={frameRef}>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "custom ancestor is not a native ref container",
    entry: BASE_SOURCE.replace(
      "Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Fram",
      "Opaque ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Opaqu",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "polymorphic selected input",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field as="button" ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "alternate polymorphic selected input",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field $as="button" ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "forwarded polymorphic selected input",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field forwardedAs="button" ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "selected spread is not authoritative",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field {...props} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "selected children override",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field children={foreign} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "duplicate selected ref attribute",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ancestor spread can change publication",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame {...props} ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "saved JSX is outside returned native tree",
    entry: BASE_SOURCE.replace(
      "return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>",
      "const saved = <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>; return saved",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "fixed child index refuses custom prefix",
    entry: BASE_SOURCE.replace(
      "ieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption",
      "rameRef.current.children[1];\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><CustomCaption /",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "fixed child index refuses conditional prefix",
    entry: BASE_SOURCE.replace(
      "ieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption>",
      "rameRef.current.children[1];\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}>{visible && <Caption>Label</Caption>}",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "fixed child index refuses fragment prefix",
    entry: BASE_SOURCE.replace(
      "ieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption",
      "rameRef.current.children[1];\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><><Caption>Label</Caption></",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "fixed child input own ref mutation",
    entry: BASE_SOURCE.replace(
      "const focusField = () => {\n    const focusTarget = fieldRef.current",
      "fieldRef.current = foreign; const focusField = () => {\n    const focusTarget = frameRef.current.children[1]",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "later conditional does not affect indexed prefix",
    entry: BASE_SOURCE.replace(
      "ieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} />",
      "rameRef.current.children[1];\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} />{visible && <CustomCaption />}",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "same rest attrs accepts arbitrary data key",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('tone: "plain', 'density: "compact'),
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "attrs cannot add custom ref",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('tone: "plain"', "ref: supplied"),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot extract ref",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs(({ theme, ref, ...rest }) => ({ theme: { ...theme }, tone: "plain", ...rest }))``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot add polymorphism",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('tone: "plai', 'as: "butto'),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot return unknown member data",
    entry: BASE_SOURCE,
    files: { "barrel.js": BASE_BARREL, "hosts.js": BASE_HOSTS.replace('"plain"', "source.value") },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot invoke data producer",
    entry: BASE_SOURCE,
    files: { "barrel.js": BASE_BARREL, "hosts.js": BASE_HOSTS.replace('"plain"', "makeTone()") },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot return function-valued data",
    entry: BASE_SOURCE,
    files: { "barrel.js": BASE_BARREL, "hosts.js": BASE_HOSTS.replace('"plain"', "() => 1") },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot replace rest with unknown props",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs(({ theme, ...rest }) => ({ theme: { ...theme }, tone: "plain", ...other }))``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot use computed returned key",
    entry: BASE_SOURCE,
    files: { "barrel.js": BASE_BARREL, "hosts.js": BASE_HOSTS.replace("tone", "[key]") },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "selected component default props replacement",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('isplayName = "Field"', 'efaultProps = { as: "button" }'),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "selected component target replacement",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('displayName = "Field"', "target = Foreign"),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "selected component object escapes",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('Field.displayName = "Field"', "publish(Field)"),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical factory property replacement",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js":
        'import styled from "styled-components";\nstyled.input = foreign; export const Field = styled.input.attrs(({ theme, ...rest }) => ({ theme: { ...theme }, tone: "plain", ...rest }))``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "named default canonical factory replacement",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace(
        ' from "styled-components"',
        ', { default as otherStyled } from "styled-components"; otherStyled.input = foreign',
      ),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "namespace consumer cannot mutate selected default props",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.js":
        'import * as Inputs from "./barrel"; Inputs.Field.defaultProps = { as: "button" };',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "unrelated selected component instance props are not mutation",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.jsx":
        'import { Field } from "./barrel"; export const Other = (props) => <Field {...props} as="textarea" ref={props.otherRef} />;',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "readonly styled derivation does not mutate base",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.jsx":
        'import styled from "styled-components"; import { Field } from "./barrel"; const Extended = styled(Field)``; export const Other = (props) => <Extended {...props} as="textarea" ref={props.otherRef} />;',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "named import forwarding barrel resolves real binding",
    entry: BASE_SOURCE,
    files: {
      "barrel.js":
        'import { Field as OwnedField, Frame, Caption } from "./hosts"; export { OwnedField as Field, Frame, Caption };',
      "hosts.js": BASE_HOSTS,
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "direct native input needs no styled declaration",
    entry: BASE_SOURCE.replace(
      'import { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame',
      "\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <div ref={frameRef}><label>Label</label><input ref={fieldRef} value={value} /></div",
    ),
    files: {},
    package: { dependencies: { react: "^18.2.0" } },
    expected: 1,
  },
  {
    name: "native focus prototype replacement refuses",
    entry: "HTMLElement.prototype.focus = replacement;\n" + BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "reflection alias cannot replace native focus",
    entry:
      'const NativeObject = Object; NativeObject.defineProperty(NativeObject.getPrototypeOf(document.createElement("input")), "focus", { value: replacement });\n' +
      BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "direct reflection cannot replace native focus",
    entry:
      'Object.defineProperty(document.createElement("input"), "focus", { value: replacement });\n' +
      BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "array indexed prototype accessor refuses",
    entry:
      'Object.defineProperty(Array.prototype, "0", { get() { return replacement; } });\n' +
      BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ordinary unrelated literal browser shim remains allowed",
    entry:
      'Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false }) });\n' +
      BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "custom JSX pragma refuses",
    entry: "/** @jsxImportSource custom */\n" + BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "provider package remap refuses",
    entry: BASE_SOURCE,
    files: BASE_FILES,
    package: {
      dependencies: { react: "^18.2.0", "styled-components": "5.3.11" },
      resolutions: { "styled-components": "./shim" },
    },
    expected: 0,
  },
  {
    name: "unsupported styled major refuses",
    entry: BASE_SOURCE,
    files: BASE_FILES,
    package: { dependencies: { react: "^18.2.0", "styled-components": "4.4.0" } },
    expected: 0,
  },
  {
    name: "custom Babel CLI transform refuses",
    entry: BASE_SOURCE,
    files: BASE_FILES,
    package: {
      dependencies: { react: "^18.2.0", "styled-components": "5.3.11" },
      scripts: { build: "babel src --plugins ./swap-input-host.js" },
    },
    expected: 0,
  },
  {
    name: "ordinary Babel build recipe remains supported",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      ".babelrc":
        '{"presets": ["@babel/preset-env", ["@babel/preset-react", {"runtime": "automatic"}]], "plugins": ["babel-plugin-styled-components"]}',
    },
    package: {
      dependencies: { react: "^18.2.0", "styled-components": "5.3.11" },
      scripts: {
        build: "cross-env NODE_ENV=production babel ./widgets --out-dir dist --copy-files",
      },
    },
    expected: 1,
  },
  {
    name: "custom Babel JSON plugin refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      ".babelrc": '{"presets": ["@babel/preset-react"], "plugins": ["./swap-input-host"]}',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ancestor Babel transform refuses",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "../barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "nested/.babelrc": '{"plugins": ["./swap-input-host"]}',
    },
    package: BASE_PACKAGE,
    expected: 0,
    entryDirectory: "nested",
  },
  {
    name: "namespace reexport cannot hide component mutation",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "bridge.js": 'export * as Inputs from "./barrel";',
      "consumer.js":
        'import { Inputs } from "./bridge"; Inputs.Field.defaultProps = { as: "button" };',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "styled provider reexport cannot hide factory mutation",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "bridge.js": 'export { default as factory } from "styled-components";',
      "consumer.js": 'import { factory } from "./bridge"; factory.input = foreign;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs own data cannot set prototype",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('tone: "plain"', '__proto__: { as: "textarea" }'),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "earlier component return makes publication dead",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return null; return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "earlier component throw makes publication dead",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  throw new Error("stopped"); return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "foreign instanceOf cannot receive Object capability",
    entry: "foreign.instanceOf(Object);\n" + BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "foreign defineProperty cannot receive Window capability",
    entry: 'foreign.defineProperty(window, "ordinary", data);\n' + BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly canonical prop types metadata remains allowed",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "meta.js":
        'import PropTypes from "prop-types"; export const metadata = { value: PropTypes.instanceOf(Object) };',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "mutated prop types metadata provider refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "meta.js":
        'import PropTypes from "prop-types"; PropTypes.instanceOf = foreign; export const metadata = { value: PropTypes.instanceOf(Object) };',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "mixed React provider useState replacement refuses",
    entry: 'import React from "react"; React.useState = foreign;\n' + BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "mixed React provider effect replacement refuses",
    entry: 'import React from "react"; React.useEffect = foreign;\n' + BASE_SOURCE,
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "one primitive CommonJS export is inert data",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "data.ts": 'module.exports = "file-stub";',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "one empty own CommonJS export is inert data",
    entry: BASE_SOURCE,
    files: { "barrel.js": BASE_BARREL, "hosts.js": BASE_HOSTS, "data.ts": "module.exports = {};" },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "CommonJS data export cannot hide executable sibling",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "data.ts": 'module.exports = "file-stub"; HTMLElement.prototype.focus = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "CommonJS nonempty object is outside inert data cut",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "data.ts": "module.exports = { value: foreign() };",
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "erased interface method names do not poison native provider",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "data.ts": "interface OptionalShape { focus(): void; }",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "selected native input cannot receive JSX children",
    entry: BASE_SOURCE.replace(" /", ">text</Field"),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ordinary computed theme data destructuring is not a provider capability",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        "export const chooseTone = (tone, { palette: { [tone]: selected } }) => selected;",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "ordinary data index writes remain supported",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "export const store = (record, key, value) => { record[key] = value; };",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "native query result unknown member mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const methodKey = ["focus"][0]; document.querySelector("input")[methodKey] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly native query alias unknown member mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const methodKey = ["focus"][0]; const nativeInput = document.querySelector("input"); nativeInput[methodKey] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly native alias chain unknown member mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const methodKey = ["focus"][0]; const nativeInput = document.querySelector("input"); const alias = nativeInput; alias[methodKey] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native created input unknown member mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const methodKey = ["focus"][0]; document.createElement("input")[methodKey] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native body unknown member mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'const methodKey = ["focus"][0]; document.body[methodKey] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native active element unknown member mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const methodKey = ["focus"][0]; document.activeElement[methodKey] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "destructured native body alias unknown member mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const methodKey = ["focus"][0]; const { body } = document; body[methodKey] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native result unknown property extraction refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const methodKey = ["focus"][0]; const { [methodKey]: extracted } = document.querySelector("input");',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "written alias native initializer unknown mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'let target = document.querySelector("input"); target = {}; const key = ["focus"][0]; target[key] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "written alias native assignment unknown mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'let target = {}; target = document.querySelector("input"); const key = ["focus"][0]; target[key] = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native result cannot escape to opaque consumer",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'configure(document.querySelector("input"));',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native readonly alias cannot escape to opaque consumer",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'const target = document.querySelector("input"); configure(target);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native result cannot escape to local unknown parameter body",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const patch = (node) => { node[["focus"][0]] = replacement; }; patch(document.querySelector("input"));',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native result cannot escape into arbitrary instance storage",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'const owner = {}; owner.target = document.querySelector("input");',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "direct native focus call remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'document.querySelector("input").focus();',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "direct native style assignment remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'document.body.style.overflow = "hidden";',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "canonical named ReactDOM portal container remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'import { createPortal } from "react-dom"; export const portal = createPortal(null, document.querySelector("body"));',
    },
    package: {
      dependencies: { react: "^18.2.0", "react-dom": "^18.2.0", "styled-components": "5.3.11" },
    },
    expected: 1,
  },
  {
    name: "canonical namespace ReactDOM portal container remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'import * as ReactDOM from "react-dom"; export const portal = ReactDOM.createPortal(null, document.querySelector("body"));',
    },
    package: {
      dependencies: { react: "^18.2.0", "react-dom": "^18.2.0", "styled-components": "5.3.11" },
    },
    expected: 1,
  },
  {
    name: "arbitrary portal spelling cannot receive native result",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const createPortal = (child, container) => null; createPortal(null, document.querySelector("body"));',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "mutated duplicate ReactDOM portal provider refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'import ReactDOM, { createPortal } from "react-dom"; ReactDOM.createPortal = replacement; export const portal = createPortal(null, document.querySelector("body"));',
    },
    package: {
      dependencies: { react: "^18.2.0", "react-dom": "^18.2.0", "styled-components": "5.3.11" },
    },
    expected: 0,
  },
  {
    name: "relative pure data namespace remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "theme-data.js": 'const tones = { primary: "blue" }; export { tones };',
      "consumer.js":
        'import * as palette from "./theme-data"; export const tone = palette.tones.primary;',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "relative canonical CSS fragment namespace remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "css-data.js":
        'import { css } from "styled-components"; export const compact = css`padding: 1px;`;',
      "consumer.js":
        'import * as fragments from "./css-data"; export const style = fragments.compact;',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "data namespace cannot carry React provider",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "data.js": 'import React from "react"; export { React };',
      "consumer.js": 'import * as values from "./data"; values.React.useRef = replacement;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "data namespace cannot contain native capability",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "data.js": "export const current = () => document.activeElement;",
      "consumer.js": 'import * as values from "./data"; export const current = values.current;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "data namespace cannot contain global string timer",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "data.js":
        "export const execute = () => setTimeout('document.querySelector(\"input\").focus = replacement', 0);",
      "consumer.js": 'import * as values from "./data"; values.execute();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "plain module string timer cannot evaluate provider replacement",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "setTimeout('document.querySelector(\"input\").focus = replacement', 0);",
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "timer value alias cannot carry string evaluator",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        "const later = setTimeout; later('document.querySelector(\"input\").focus = replacement', 0);",
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "direct inline timer callback remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "setTimeout(() => {}, 0);",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "direct readonly own timer callback remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "const callback = () => {}; setTimeout(callback, 0);",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "zero argument timer conservatively declines without crashing",
    entry: BASE_SOURCE,
    files: { "barrel.js": BASE_BARREL, "hosts.js": BASE_HOSTS, "consumer.ts": "setTimeout();" },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "finite concatenated constructor acquisition refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = "con" + "structor"; const compile = (() => {})[key]; compile(\'document.querySelector("input").focus = replacement\')();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "unknown computed own function capability acquisition refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const compile = (() => {})[key]; compile(\'document.querySelector("input").focus = replacement\')();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "finite concatenated destructured constructor acquisition refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = "con" + "structor"; const { [key]: compile } = () => {}; compile(\'document.querySelector("input").focus = replacement\')();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own input event currentTarget unknown mutation refuses",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={(event) => { const key = ["focus"][0]; event.currentTarget[key] = replacement; }} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own input event target unknown mutation refuses",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={(event) => { const key = ["focus"][0]; event.target[key] = replacement; }} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly event object alias retains native target origin",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={(event) => { const alias = event; const key = ["focus"][0]; alias.currentTarget[key] = replacement; }} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly event target alias retains native target origin",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={(event) => { const target = event.currentTarget; const key = ["focus"][0]; target[key] = replacement; }} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "input event scalar value transport remains admitted",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onChange={(event) => onValue(event.target.value)} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "input event destructured scalar value transport remains admitted",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onChange={({ target }) => onValue(target.value)} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "input event scalar key transport remains admitted",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onKeyDown={(event) => onKey(event.key)} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "unsupported whole event transport declines",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={(event) => configure(event)} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "unresolved selected input handler declines",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={externalHandler} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "prop selected input handler declines",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={props.handler} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own zero parameter selected input handler remains admitted",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={() => notify()} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "implicit arguments event acquisition conservatively declines",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onFocus={function () { configure(arguments[0].currentTarget); }} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot add hidden event callback",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('tone: "plain"', "onFocus: importedHandler"),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot extract controlled value",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs(({ theme, value, ...rest }) => ({ theme: { ...theme }, tone: "plain", ...rest }))``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot override controlled value",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS.replace('tone: "plain', 'value: "fixed'),
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "attrs cannot extract native event callback",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs(({ theme, onFocus, ...rest }) => ({ theme: { ...theme }, tone: "plain", ...rest }))``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly own named input callback remains admitted",
    entry: BASE_SOURCE.replace(
      "focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field",
      "onFieldChange = (event) => onValue(event.target.value); const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onChange={onFieldChange}",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "named input callback with non-event caller conservatively declines",
    entry: BASE_SOURCE.replace(
      "focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field",
      "onFieldChange = (event) => onValue(event.target.value); onFieldChange({ target: { value: document.body } }); const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onChange={onFieldChange}",
    ),
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own native input event methods and scalar value remain admitted",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field onChange={(event) => { event.preventDefault(); onValue(event.target.value); }} ref={fieldRef} value={value} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "direct window listener event target unknown mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["focus"][0]; window.addEventListener("focus", event => { event.target[key] = replacement; }, true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "direct window listener event currentTarget unknown mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["focus"][0]; window.addEventListener("focus", event => { event.currentTarget[key] = replacement; }, true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "direct document listener event target unknown mutation refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["focus"][0]; document.addEventListener("focus", event => { event.target[key] = replacement; }, true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly own listener event alias retains target origin",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["focus"][0]; const handler = event => { const alias = event; alias.target[key] = replacement; }; window.addEventListener("focus", handler, true); window.removeEventListener("focus", handler, true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own key-only native listener remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const handler = ({ key }) => onKey(key); window.addEventListener("keydown", handler); window.removeEventListener("keydown", handler);',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "native listener event key scalar transport remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'window.addEventListener("keydown", event => onKey(event.key));',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "native listener event methods remain admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'window.addEventListener("keydown", event => { event.preventDefault(); onKey(event.key); });',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "native listener target cannot escape to unknown consumer",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'window.addEventListener("focus", event => configure(event.target), true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native listener callback outside emitter domain declines",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const handler = ({ key }) => onKey(key); handler({ key: "x" }); window.addEventListener("keydown", handler);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native listener implicit arguments acquisition declines",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'window.addEventListener("focus", function () { configure(arguments[0].target); });',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native callable member alias constructor evaluator refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const callable = [].map; const compile = callable[key]; compile(\'document.querySelector("input").focus = replacement\')();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native callable constructor acquisition direct call refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; ([].map)[key](\'document.querySelector("input").focus = replacement\')();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "native callable constructor acquisition readonly alias chain refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const callable = [].map; const compile = callable[key]; const alias = compile; alias(\'document.querySelector("input").focus = replacement\')();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "unknown computed callable tag conservatively declines",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "const key = source; const table = unknownTable; table[key]`data`;",
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "ordinary unknown data lookup with scalar consumer remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        "export const choose = (items, index) => { const value = items[index]; onValue(value); };",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "native callable acquisition cannot hide inside aggregate",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const entries = [([].map)[key]]; entries[0](\'document.querySelector("input").focus = replacement\')();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "bare global listener spelling conservatively declines",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["focus"][0]; addEventListener("focus", event => { event.target[key] = replacement; }, true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "bare global listener value extraction conservatively declines",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "const stop = removeEventListener;",
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own callee cannot invoke unknown computed native constructor",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const execute = compile => compile(\'document.querySelector("input").focus = replacement\')(); execute(([].map)[key]);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own callee scalar-only parameter transport remains admitted",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        "const accept = value => onValue(value); export const choose = (items, index) => { const value = items[index]; accept(value); };",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "own callee default parameter transport conservatively declines",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const execute = (compile = fallback) => compile("data")(); execute(([].map)[key]);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own callee rest parameter transport conservatively declines",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const execute = (...values) => values[0]("data")(); execute(([].map)[key]);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "explicit call transport of unknown computed constructor declines",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const invoke = compile => compile("data")(); invoke.call(null, ([].map)[key]);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "foreign readonly styled native ref remains admitted",
    expected: 1,
    entry: BASE_SOURCE,
    package: BASE_PACKAGE,
    files: {
      ...BASE_FILES,
      ...{
        "foreign.tsx":
          "import {useRef} from 'react'; import styled from 'styled-components'; const OtherHost=styled.button``; export const Other=()=>{const otherRef=useRef(null);const ownsFocus=()=>otherRef.current?.contains(document.activeElement);return <OtherHost ref={otherRef}/>};",
      },
    },
  },
  {
    name: "foreign styled native host default props replacement refuses",
    expected: 0,
    entry: BASE_SOURCE,
    package: BASE_PACKAGE,
    files: {
      ...BASE_FILES,
      ...{
        "foreign.tsx":
          "import {useRef} from 'react'; import styled from 'styled-components'; const OtherHost=styled.button``; OtherHost.defaultProps={as:'custom-host'}; export const Other=()=>{const otherRef=useRef(null);const ownsFocus=()=>otherRef.current?.contains(document.activeElement);return <OtherHost ref={otherRef}/>};",
      },
    },
  },
  {
    name: "foreign styled native host barrel consumer mutation refuses",
    expected: 0,
    entry: BASE_SOURCE,
    package: BASE_PACKAGE,
    files: {
      ...BASE_FILES,
      ...{
        "foreign-host.ts":
          "import styled from 'styled-components';export const OtherHost=styled.button``;",
        "foreign-barrel.ts": "export {OtherHost} from './foreign-host';",
        "foreign.tsx":
          "import {useRef} from 'react';import {OtherHost} from './foreign-barrel';export const Other=()=>{const otherRef=useRef(null);const ownsFocus=()=>otherRef.current?.contains(document.activeElement);return <OtherHost ref={otherRef}/>};",
        "foreign-mutation.ts":
          "import {OtherHost} from './foreign-barrel';OtherHost.defaultProps={as:'custom-host'};",
      },
    },
  },
  {
    name: "destructured native body binding is not a runtime native escape",
    entry: BASE_SOURCE,
    package: BASE_PACKAGE,
    files: {
      ...BASE_FILES,
      "consumer.ts": "const { body } = document; body.contains(document.activeElement);",
    },
    expected: 1,
  },
  {
    name: "destructured native body runtime mutation still refuses",
    entry: BASE_SOURCE,
    package: BASE_PACKAGE,
    files: {
      ...BASE_FILES,
      "consumer.ts": "const { body } = document; body[opaqueKey] = replacement;",
    },
    expected: 0,
  },
  {
    name: "renamed native body runtime mutation still refuses",
    entry: BASE_SOURCE,
    package: BASE_PACKAGE,
    files: {
      ...BASE_FILES,
      "consumer.ts": "const { body: owner } = document; owner[opaqueKey] = replacement;",
    },
    expected: 0,
  },
  {
    name: "anonymous default styled ancestor closes through source origin",
    entry: BASE_SOURCE,
    package: BASE_PACKAGE,
    files: {
      ...BASE_FILES,
      "anonymous-host.ts": "import styled from 'styled-components';export default styled.div``;",
      "anonymous-barrel.ts": "export {default as Frame} from './anonymous-host';",
      "foreign.tsx":
        "import {useRef} from 'react';import {Frame} from './anonymous-barrel';export const Foreign=()=>{const list=useRef(null);const ownsFocus=()=>list.current?.contains(document.activeElement);return <Frame><ul ref={list}/></Frame>};",
    },
    expected: 1,
  },
  {
    name: "anonymous default alternate importer mutation refuses",
    entry: BASE_SOURCE,
    package: BASE_PACKAGE,
    files: {
      ...BASE_FILES,
      "anonymous-host.ts": "import styled from 'styled-components';export default styled.div``;",
      "anonymous-barrel.ts": "export {default as Frame} from './anonymous-host';",
      "foreign.tsx":
        "import {useRef} from 'react';import {Frame} from './anonymous-barrel';export const Foreign=()=>{const list=useRef(null);const ownsFocus=()=>list.current?.contains(document.activeElement);return <Frame><ul ref={list}/></Frame>};",
      "alternate-consumer.ts":
        "import OtherFrame from './anonymous-host';OtherFrame.defaultProps={as:'custom-host'};",
    },
    expected: 0,
  },
  {
    name: "ordinary scalar lookup return remains data",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'export const choose = (key) => ({ small: "1px", large: "2px" })[key];',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "ordinary readonly lookup alias return remains data",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        "export const choose = (items, index) => { const selected = items[index]; return selected; };",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "ordinary lookup object aggregate remains data",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "export const choose = (items, index) => ({ selected: items[index] });",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "ordinary lookup array aggregate remains data",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "export const choose = (items, index) => [items[index]];",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "ordinary lookup spread remains data",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "export const choose = (items, index) => ({ ...items[index] });",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "ordinary lookup assignment remains data",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        "export const choose = (items, index) => { let selected; selected = items[index]; return selected; };",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "ordinary indexed record scalar field mutation remains data",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": "export const update = (items, index) => { items[index].opened = true; };",
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "unknown prototype carrier cannot change host override field",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["__proto__"][0]; const target = ({})[key]; target.as = "button";',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "known native callable constructor returned through data carrier refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; export const get = () => ([].map)[key]; get()(\'document.querySelector("input").focus = replacement\')();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "known native string callable constructor acquisition refuses",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const key = ["constructor"][0]; const method = "text".slice; const compile = method[key]; export const get = () => compile;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "computed callable logical result reaches call terminal",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'const compile = unknownTable[opaqueKey]; (compile || fallback)("data");',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "computed callable conditional result reaches call terminal",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts":
        'const compile = unknownTable[opaqueKey]; (condition ? compile : fallback)("data");',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "computed callable sequence final result reaches call terminal",
    entry: BASE_SOURCE,
    files: {
      "barrel.js": BASE_BARREL,
      "hosts.js": BASE_HOSTS,
      "consumer.ts": 'const compile = unknownTable[opaqueKey]; (observe(), compile)("data");',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly array receiver alias retains constructor refusal",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const items = []; const method = items.map; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly string receiver alias retains constructor refusal",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const text = "sample"; const method = text.slice; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "numeric literal method constructor refusal",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = (0).toString; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "regexp literal method constructor refusal",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = /sample/.test; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly regexp alias method constructor refusal",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const pattern = /sample/; const method = pattern.test; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "boolean literal method constructor refusal",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = true.valueOf; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical parseInt callable global constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = parseInt; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical parseFloat callable global constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = parseFloat; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical Number callable global constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = Number; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical Array callable global constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = Array; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical RegExp callable global constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = RegExp; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical Promise callable global constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = Promise; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical Error callable global constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = TypeError; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "negative numeric literal method constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = (-1).toString; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly signed numeric receiver alias method constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const number = -1; const method = number.toString; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "shadowed callable-global spelling remains ordinary data",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const Number = { values: ["small", "large"] }; export const read = (index) => { const values = Number.values; return values[index]; };',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "canonical namespace native function constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = Math.abs; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical JSON namespace function constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = JSON.stringify; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "readonly canonical namespace alias constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const native = Math; const method = native.abs; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "canonical constructor static method constructor transport refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const method = Number.parseInt; const key = ["constructor"][0]; const compile = method[key]; const get = () => compile; get()("document.querySelector(\\"input\\").focus = replacement")();',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "bound namespace-like data member remains ordinary scalar",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const Math = { values: ["small", "large"] }; export const read = (index) => Math.values[index];',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "own listener implicit global event refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const key = ["focus"][0]; window.addEventListener("focus", () => { event.target[key] = replacement; }, true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own listener nested arrow implicit global event refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const key = ["focus"][0]; window.addEventListener("focus", () => { const update = () => { event.target[key] = replacement; }; update(); }, true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "selected input implicit global event refuses",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} onFocus={() => { event.target[opaqueKey] = replacement; }} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "selected input nested arrow global event refuses",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} onFocus={() => { const update = () => { event.target[opaqueKey] = replacement; }; update(); }} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "own listener nested lexical arguments refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts":
        'const key = ["focus"][0]; window.addEventListener("focus", function () { const update = () => { arguments[0].target[key] = replacement; }; update(); }, true);',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "bound scalar event parameter retains ordinary reads",
    entry:
      'import { useRef } from "react";\nimport { Field, Frame, Caption } from "./barrel";\nexport const Panel = ({ value }) => {\n  const frameRef = useRef();\n  const fieldRef = useRef(null);\n  const focusField = () => {\n    const focusTarget = fieldRef.current;\n    if (focusTarget) focusTarget.focus();\n  };\n  const hasFocus = () => frameRef.current?.contains(document.activeElement);\n  return <Frame ref={frameRef}><Caption>Label</Caption><Field ref={fieldRef} value={value} onFocus={(event) => consume(event.key)} /></Frame>;\n};\n',
    files: BASE_FILES,
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "local event data spelling remains ordinary",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.ts": 'const event = { label: "ready" }; export const read = () => event.label;',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "own scalar literal attrs preserve selected input",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ role: "textbox", title: "Field" })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "literal attrs ref refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ ref: foreignRef })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "literal attrs host override refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ as: "textarea" })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "literal attrs controlled value refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ value: "fixed" })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "literal attrs event handler refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ onFocus: () => foreign() })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "literal attrs spread refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ ...defaults })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "literal attrs getter refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ get role() { return "textbox"; } })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "literal attrs computed key refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ ["role"]: "textbox" })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "literal attrs prototype refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ __proto__: { as: "textarea" } })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "multiple closed literal attrs calls preserve selected input",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "hosts.js":
        'import styled from "styled-components";\nexport const Field = styled.input.attrs({ role: "textbox" }).attrs({ title: "Field" })``;\nexport const Frame = styled.div``;\nexport const Caption = styled.label``;\nField.displayName = "Field";\nField.propTypes = {};\n',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "imported ancestor styled attrs consumer remains readonly",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.tsx":
        'import styled from "styled-components"; import { Frame } from "./barrel"; const Derived = styled(Frame).attrs({ role: "group" })``; export const Other = () => <Derived />;',
    },
    package: BASE_PACKAGE,
    expected: 1,
  },
  {
    name: "imported ancestor styled attrs host override refuses",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.tsx":
        'import styled from "styled-components"; import { Frame } from "./barrel"; const Derived = styled(Frame).attrs({ as: "custom-host" })``; export const Other = () => <Derived />;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
  {
    name: "unproved styled withConfig consumer remains unsupported",
    entry: BASE_SOURCE,
    files: {
      ...BASE_FILES,
      "consumer.tsx":
        'import styled from "styled-components"; import { Frame } from "./barrel"; const Derived = styled(Frame).withConfig({ displayName: "Derived" })``; export const Other = () => <Derived />;',
    },
    package: BASE_PACKAGE,
    expected: 0,
  },
];

describe("resolveOwnedInputFocusTarget", () => {
  it.each(fixtureCases)("$name", (fixture) => {
    const { filename } = writeFixture(fixture);
    const filenames = fixture.checkRelativeFilename
      ? [filename, path.relative(process.cwd(), filename)]
      : [filename];
    for (const filename of filenames) {
      resetFilesystemCaches();
      const result = runRule(probeRule, fixture.entry, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(fixture.expected);
    }
  });

  it("rechecks foreign host data across filesystem epochs with the same entry AST", () => {
    const fixture = fixtureCases[0];
    const { root, filename } = writeFixture(fixture);
    const parsed = parseFixture(fixture.entry, { filename });
    const capture = () => {
      resetFilesystemCaches();
      return runRuleOnParsedFixture(probeRule, fixture.entry, parsed, { filename }).diagnostics;
    };
    expect(capture()).toHaveLength(1);
    fs.writeFileSync(
      path.join(root, "hosts.js"),
      fixture.files["hosts.js"].replace("styled.input", "styled.div"),
    );
    expect(capture()).toHaveLength(0);
    fs.writeFileSync(path.join(root, "hosts.js"), fixture.files["hosts.js"]);
    expect(capture()).toHaveLength(1);
  });

  it("rechecks compiler configuration across filesystem epochs with the same entry AST", () => {
    const fixture = fixtureCases[0];
    const { root, filename } = writeFixture(fixture);
    const parsed = parseFixture(fixture.entry, { filename });
    const capture = () => {
      resetFilesystemCaches();
      return runRuleOnParsedFixture(probeRule, fixture.entry, parsed, { filename }).diagnostics;
    };
    expect(capture()).toHaveLength(1);
    fs.writeFileSync(path.join(root, ".babelrc"), JSON.stringify({ plugins: ["./swap-host"] }));
    expect(capture()).toHaveLength(0);
    fs.unlinkSync(path.join(root, ".babelrc"));
    expect(capture()).toHaveLength(1);
  });
});
