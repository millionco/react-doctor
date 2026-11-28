import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

const field = `import { useEffect, useState } from "react";

function TextField({ current, changeValue }) {
  return <input value={current} onChange={(event) => changeValue(event.target.value)} />;
}`;

const editor = `export function AddressEditor({ source }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(source);
  }, [source]);
  return <TextField current={text} changeValue={setText} />;
}`;

const fieldWithLock = field
  .replace("{ current, changeValue }", "{ current, changeValue, lock = false }")
  .replace("<input", "<input readOnly={lock}");

describe("no-derived-state with a setter forwarded to a local input", () => {
  it("recognizes an independent edit from the rendered text field", () => {
    const result = runRule(noDerivedState, field + "\n" + editor, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes an independent edit through a private React forwardRef", () => {
    const forwardRef = field
      .replace("useEffect, useState", "forwardRef, useEffect, useState")
      .replace(
        "function TextField({ current, changeValue }) {",
        "const TextField = forwardRef(({ current, changeValue }, ref) => {",
      )
      .replace(/}$/, "});");
    const result = runRule(noDerivedState, forwardRef + "\n" + editor, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes an omitted boolean prop that defaults to editable", () => {
    const result = runRule(noDerivedState, fieldWithLock + "\n" + editor, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "an unverified customized input element",
      field.replace("<input", '<input is="special-input"'),
      editor,
    ],
    [
      "a replaced wrapper method",
      field
        .replace("import { useEffect, useState }", "import React, { useEffect, useState }")
        .replace(
          "function TextField({ current, changeValue }) {",
          "React.forwardRef = () => () => null; const TextField = React.forwardRef(({ current, changeValue }, ref) => {",
        )
        .replace(/}$/, "});"),
      editor,
    ],
    [
      "a reserved JSX key used as a setter",
      field.replaceAll("changeValue", "key"),
      editor.replace("changeValue={setText}", "key={setText}"),
    ],
    [
      "a reserved ref used as a setter",
      field.replaceAll("changeValue", "ref"),
      editor.replace("changeValue={setText}", "ref={setText}"),
    ],
    [
      "a reserved JSX key used as a value",
      field.replaceAll("current", "key"),
      editor.replace("current={text}", "key={text}"),
    ],
    [
      "a statically unreachable field",
      field,
      editor.replace("return <TextField", "if (true) return null; return <TextField"),
    ],
    [
      "invalid content on the input",
      field.replace("<input", "<input dangerouslySetInnerHTML={{__html: content}}"),
      editor,
    ],
    [
      "an input hidden with inline style",
      field.replace("<input", '<input style={{display: "none"}}'),
      editor,
    ],
    [
      "an ancestor hidden with inline style",
      field,
      editor.replace(
        "<TextField current={text} changeValue={setText} />",
        '<div style={{display: "none"}}><TextField current={text} changeValue={setText} /></div>',
      ),
    ],
    [
      "an interfering native event",
      field.replace("<input", "<input onInputCapture={blockEdits}"),
      editor,
    ],
    [
      "an interfering ancestor event",
      field,
      editor.replace(
        "<TextField current={text} changeValue={setText} />",
        "<div onKeyDownCapture={blockEdits}><TextField current={text} changeValue={setText} /></div>",
      ),
    ],
    [
      "an unproven ancestor spread",
      field,
      editor.replace(
        "<TextField current={text} changeValue={setText} />",
        "<div {...extra}><TextField current={text} changeValue={setText} /></div>",
      ),
    ],
    [
      "an effectful default prop",
      field.replace(
        "{ current, changeValue }",
        "{ current, changeValue, omitted = failToMount() }",
      ),
      editor,
    ],
    [
      "an unexpected ref default",
      field.replace("{ current, changeValue })", "{ current, changeValue }, ref = failToMount())"),
      editor,
    ],
    ["an enabled read-only prop", fieldWithLock, editor.replace("<TextField", "<TextField lock")],
    [
      "an unknown read-only prop",
      fieldWithLock,
      editor.replace("<TextField", "<TextField lock={getLock()}"),
    ],
    [
      "a read-only prop defaulting to true",
      fieldWithLock.replace("lock = false", "lock = true"),
      editor,
    ],

    [
      "an exported provider",
      field.replace("function TextField", "export function TextField"),
      editor,
    ],
    ["an escaped provider", field + "\ninstallProvider(TextField);", editor],
    [
      "an SVG tree",
      field,
      editor.replace(
        "<TextField current={text} changeValue={setText} />",
        "<svg><TextField current={text} changeValue={setText} /></svg>",
      ),
    ],
    ["a disabled input", field.replace("<input", "<input disabled"), editor],
    ["a read-only input", field.replace("<input", "<input readOnly"), editor],
    ["a non-editable type", field.replace("<input", '<input type="hidden"'), editor],
    ["an unknown type", field.replace("<input", "<input type={getType()}"), editor],
    ["an unrelated value", field.replace("value={current}", 'value="fixed"'), editor],
    [
      "an eager setter call",
      field.replace("(event) => changeValue(event.target.value)", 'changeValue("initial")'),
      editor,
    ],
    [
      "an unused setter",
      field.replace("changeValue(event.target.value)", "save(event.target.value)"),
      editor,
    ],
    ["a different event payload", field.replace("event.target.value", "getValue()"), editor],
    ["an overriding provider spread", field.replace(" />", " {...extra} />"), editor],
    ["an overriding caller spread", field, editor.replace(" />", " {...extra} />")],
    [
      "a detached JSX expression",
      field,
      editor
        .replace("return <TextField", "const unused = <TextField")
        .replace(" />;", " />; return null;"),
    ],
    ["a different controlled state", field, editor.replace("current={text}", 'current="fixed"')],
    ["a shadowed setter", field.replace("(event) =>", "(event, changeValue) =>"), editor],
    [
      "a disabled fieldset",
      field,
      editor.replace(
        "<TextField current={text} changeValue={setText} />",
        "<fieldset disabled><TextField current={text} changeValue={setText} /></fieldset>",
      ),
    ],
  ])("reports the effect with %s", (_label, provider, consumer) => {
    const result = runRule(noDerivedState, provider + "\n" + consumer, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
