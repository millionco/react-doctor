import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import type { Rule } from "../../utils/rule.js";
import { noDerivedState } from "./no-derived-state.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { hasSupportedRadixPendingDraft } from "./utils/has-supported-radix-pending-draft.js";

interface DraftFixtureFiles {
  readonly [relativePath: string]: string;
}
interface PendingDraftCase {
  readonly name: string;
  readonly files?: DraftFixtureFiles;
  readonly certificate: boolean;
  readonly diagnostics?: number;
}
const fixtures: DraftFixtureFiles = JSON.parse(
  fs.readFileSync(
    new URL("./no-derived-state.radix-pending-draft.fixtures.json", import.meta.url),
    "utf8",
  ),
);
const replaceFile = (relativePath: string, before: string, after: string): DraftFixtureFiles => {
  if (!fixtures[relativePath].includes(before))
    throw new Error("Fixture replacement source is missing");
  return { [relativePath]: fixtures[relativePath].replace(before, after) };
};
const cases: ReadonlyArray<PendingDraftCase> = [
  {
    name: "direct native Radix default menu",
    files: {
      "panel.tsx":
        'import { useEffect, useState } from "react";\nimport * as Menu from "@radix-ui/react-dropdown-menu";\nexport const DraftChoices = ({ values, options }) => {\n  const [draft, setDraft] = useState(values);\n  useEffect(() => { setDraft(values); }, [values]);\n  const toggleChoice = (event, selectedValue) => {\n    event.preventDefault();\n    if (selectedValue === undefined) return;\n    if (draft.includes(selectedValue)) {\n      const next = draft.filter((entry) => entry !== selectedValue);\n      setDraft(next);\n    } else {\n      const next = [...draft, selectedValue];\n      setDraft(next);\n    }\n  };\n  const renderChoice = (option) => {\n    const { value: choiceValue, ...optionRest } = option;\n    const choiceProps = { value: choiceValue, onSelect: (event) => toggleChoice(event, choiceValue), children: draft.includes(choiceValue) ? "Selected" : "Unselected", ...optionRest };\n    return <Menu.Item {...choiceProps} />;\n  };\n  return <Menu.Root><Menu.Trigger>Choose</Menu.Trigger><Menu.Content>{options.map(renderChoice)}</Menu.Content></Menu.Root>;\n};\n',
    },
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "default plain options with grouping and two content bridges",
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "readonly Fragment in the inactive grouping route",
    files: {
      "panel.tsx": fixtures["panel.tsx"]
        .replace("useEffect, useMemo, useState", "Fragment, useEffect, useMemo, useState")
        .replace(
          "<div>{categoryOptions.map(renderChoice)}</div>",
          "<Fragment>{categoryOptions.map(renderChoice)}</Fragment>",
        ),
    },
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "default trigger variant explicit",
    files: replaceFile(
      "panel.tsx",
      "<NativeTrigger disabled",
      '<NativeTrigger variant="default" disabled',
    ),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "transparent record assertion",
    files: replaceFile("panel.tsx", "...optionRest };", "...optionRest } as any;"),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "disabled item override",
    files: replaceFile(
      "panel.tsx",
      "value: choiceValue, onSelect",
      "value: choiceValue, disabled: true, onSelect",
    ),
    certificate: false,
  },
  {
    name: "definite undefined callback override",
    files: replaceFile("panel.tsx", "...optionRest };", "...optionRest, onSelect: undefined };"),
    certificate: false,
  },
  {
    name: "definite null callback override",
    files: replaceFile("panel.tsx", "...optionRest };", "...optionRest, onSelect: null };"),
    certificate: false,
  },
  {
    name: "definite noop callback override",
    files: replaceFile("panel.tsx", "...optionRest };", "...optionRest, onSelect: () => {} };"),
    certificate: false,
  },
  {
    name: "item click cancellation",
    files: replaceFile(
      "panel.tsx",
      "value: choiceValue, onSelect",
      "value: choiceValue, onClick: (event) => event.preventDefault(), onSelect",
    ),
    certificate: false,
  },
  {
    name: "required callback guard",
    files: replaceFile(
      "panel.tsx",
      "onSelect: (event) => toggleChoice(event, choiceValue)",
      "onSelect: (event) => allowed && toggleChoice(event, choiceValue)",
    ),
    certificate: false,
  },
  {
    name: "eager writer",
    files: replaceFile(
      "panel.tsx",
      "onSelect: (event) => toggleChoice(event, choiceValue)",
      "onSelect: toggleChoice(event, choiceValue)",
    ),
    certificate: false,
  },
  {
    name: "wrong state callback",
    files: replaceFile(
      "panel.tsx",
      "onSelect: (event) => toggleChoice(event, choiceValue)",
      "onSelect: (event) => otherAction(event, choiceValue)",
    ),
    certificate: false,
  },
  {
    name: "record never consumed",
    files: replaceFile(
      "panel.tsx",
      "return <ChoiceEntry {...choiceProps} />;",
      "return <ChoiceEntry />;",
    ),
    certificate: false,
  },
  {
    name: "named import aliases",
    files: {
      "panel.tsx": fixtures["panel.tsx"]
        .replace("import { ChoiceEntry }", "import { ChoiceEntry as RenamedEntry }")
        .replaceAll("<ChoiceEntry", "<RenamedEntry"),
    },
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "runtime barrel route unsupported",
    files: {
      "panel.tsx": fixtures["panel.tsx"].replace('from "./entry"', 'from "./entry-bridge"'),
      "entry-bridge.ts": 'export { ChoiceEntry } from "./entry";',
    },
    certificate: false,
  },
  {
    name: "bare side-effect provider import",
    files: {
      "surface.tsx": 'import "./patch";\n' + fixtures["surface.tsx"],
      "patch.ts": "export {};",
    },
    certificate: false,
  },
  {
    name: "callback never invoked",
    files: replaceFile(
      "entry.tsx",
      "<Menu.Item data-value={String(value)} {...props}>",
      "<Menu.Item data-value={String(value)}>",
    ),
    certificate: false,
  },
  {
    name: "callback consumed by private wrapper",
    files: replaceFile(
      "entry.tsx",
      "value, label, startIcon, disabled, ...props",
      "value, label, startIcon, disabled, onSelect, ...props",
    ),
    certificate: false,
  },
  {
    name: "item after-spread cancellation",
    files: replaceFile(
      "entry.tsx",
      "{...props}><span>",
      "{...props} onClick={(event) => event.preventDefault()}><span>",
    ),
    certificate: false,
  },
  {
    name: "fixed closed root",
    files: replaceFile("surface.tsx", "open={open}", "open={false}"),
    certificate: false,
  },
  {
    name: "fixed disabled trigger",
    files: replaceFile("surface.tsx", "disabled={disabled}", "disabled={true}"),
    certificate: false,
  },
  {
    name: "fake opening hook",
    files: replaceFile(
      "panel.tsx",
      "const [isOpen, setIsOpen] = useState(false);",
      "const usePair = () => [false, () => {}]; const [isOpen, setIsOpen] = usePair();",
    ),
    certificate: false,
  },
  {
    name: "open change callback dropped",
    files: replaceFile("surface.tsx", "onOpenChange={onOpenChange}", "onOpenChange={() => {}}"),
    certificate: false,
  },
  {
    name: "trigger native click cancellation",
    files: replaceFile(
      "trigger.tsx",
      "return <button ref={ref}",
      "return <button onClick={(event) => event.preventDefault()} ref={ref}",
    ),
    certificate: false,
  },
  {
    name: "ghost trigger mode",
    files: replaceFile(
      "panel.tsx",
      "<NativeTrigger disabled",
      '<NativeTrigger variant="ghost" disabled',
    ),
    certificate: false,
  },
  {
    name: "known ancestor disabled spread",
    files: replaceFile("panel.tsx", "<MenuSurface open", "<MenuSurface {...{disabled:true}} open"),
    certificate: false,
  },
  {
    name: "opaque ancestor spread",
    files: replaceFile("panel.tsx", "<MenuSurface open", "<MenuSurface {...surfaceProps} open"),
    certificate: false,
  },
  {
    name: "unrelated callback receives children",
    files: replaceFile(
      "content.tsx",
      "useEffect(() => {}, [children]);",
      "opaque(other, [children]);",
    ),
    certificate: false,
  },
  {
    name: "content drops children",
    files: replaceFile(
      "content.tsx",
      "return <div {...props}>{children}</div>;",
      "return <div {...props} />;",
    ),
    certificate: false,
  },
  {
    name: "content early return",
    files: replaceFile(
      "content.tsx",
      "return <div {...props}>{children}</div>;",
      "if (blocked) return null; return <div {...props}>{children}</div>;",
    ),
    certificate: false,
  },
  {
    name: "opaque option producer",
    files: replaceFile("panel.tsx", " : options;", " : supplyOptions(options);"),
    certificate: false,
  },
  {
    name: "copied empty source is not selectable options",
    files: replaceFile("panel.tsx", " : options;", " : values;"),
    certificate: false,
  },
  {
    name: "grouping seeded record",
    files: replaceFile("group.ts", "}, {});", "}, { forced: [] });"),
    certificate: false,
  },
  {
    name: "grouping branch has opaque effect",
    files: replaceFile(
      "group.ts",
      "const category = option.category;",
      "publish(option); const category = option.category;",
    ),
    certificate: false,
  },
  {
    name: "inherited property is not absent",
    files: { "group.ts": fixtures["group.ts"].replaceAll("option.category", "option.toString") },
    certificate: false,
  },
  {
    name: "grouping returns a nonempty record",
    files: replaceFile("group.ts", "? null : result", "? {} : result"),
    certificate: false,
  },
  {
    name: "readonly ordinary property renamed",
    files: replaceFile("group.ts", "option.category", "option.value"),
    certificate: false,
  },
  {
    name: "source-visible global provider mutation",
    files: { "group.ts": 'Object.keys = () => ["forced"];\n' + fixtures["group.ts"] },
    certificate: false,
  },
  {
    name: "erased eval binding",
    files: { "surface.tsx": 'interface eval {}\neval("publish()");\n' + fixtures["surface.tsx"] },
    certificate: false,
  },
  {
    name: "computed constructor extraction",
    files: {
      "surface.tsx":
        'const key = "constructor"; const method = [].map; const Constructor = method[key]; Constructor("publish()");\n' +
        fixtures["surface.tsx"],
    },
    certificate: false,
  },
  {
    name: "destructured constructor extraction",
    files: {
      "surface.tsx":
        'const method = [].map; const { constructor: Constructor } = method; Constructor("publish()");\n' +
        fixtures["surface.tsx"],
    },
    certificate: false,
  },
  {
    name: "runtime enum capability",
    files: { "surface.tsx": "enum Patch { Active = publish() }\n" + fixtures["surface.tsx"] },
    certificate: false,
  },
  {
    name: "catch binding capability scope",
    files: {
      "surface.tsx": "try {} catch (failure) { publish(failure); }\n" + fixtures["surface.tsx"],
    },
    certificate: false,
  },
  {
    name: "local React replacement",
    files: {
      "surface.tsx": "const React = { createElement: publish };\n" + fixtures["surface.tsx"],
    },
    certificate: false,
  },
  {
    name: "namespace SDK mutation",
    files: { "surface.tsx": fixtures["surface.tsx"] + "\nMenu.Item = Replacement;" },
    certificate: false,
  },
  {
    name: "SDK namespace escape",
    files: { "surface.tsx": fixtures["surface.tsx"] + "\npublish(Menu);" },
    certificate: false,
  },
  {
    name: "unused menu JSX",
    files: {
      "panel.tsx": fixtures["panel.tsx"]
        .replace("return <MenuSurface", "const unused = <MenuSurface")
        .replace("</MenuSurface>;", "</MenuSurface>; return null;"),
    },
    certificate: false,
  },
  {
    name: "false children carrier",
    files: replaceFile(
      "content.tsx",
      "<div {...props}>{children}</div>",
      "<div {...props}>{false && <div>{children}</div>}</div>",
    ),
    certificate: false,
  },
  {
    name: "false content branch",
    files: replaceFile(
      "surface.tsx",
      "<Menu.Content style={{ zIndex: 5 }}>{children}</Menu.Content>",
      "<div>{false && <Menu.Content style={{ zIndex: 5 }}>{children}</Menu.Content>}</div>",
    ),
    certificate: false,
  },
  {
    name: "trigger earlier return",
    files: replaceFile(
      "trigger.tsx",
      "return <button ref={ref}",
      "return null; return <button ref={ref}",
    ),
    certificate: false,
  },
  {
    name: "provider eagerly invokes opening callback",
    files: replaceFile(
      "surface.tsx",
      "  return <Menu.Root",
      "  onOpenChange(false); return <Menu.Root",
    ),
    certificate: false,
  },
  {
    name: "opening setter argument escape",
    files: replaceFile(
      "panel.tsx",
      "  const [draft, setDraft]",
      "  closeDuringRender(setIsOpen);\n  const [draft, setDraft]",
    ),
    certificate: false,
  },
  {
    name: "opening setter alias escape",
    files: replaceFile(
      "panel.tsx",
      "  const [draft, setDraft]",
      "  const close = setIsOpen; close(false);\n  const [draft, setDraft]",
    ),
    certificate: false,
  },
  {
    name: "opening close writer called during render",
    files: replaceFile(
      "panel.tsx",
      "  const clearChoice =",
      "  commitChoice(values);\n  const clearChoice =",
    ),
    certificate: false,
  },
  {
    name: "opening close writer passed to opaque consumer",
    files: replaceFile(
      "panel.tsx",
      "  const clearChoice =",
      "  publish(commitChoice);\n  const clearChoice =",
    ),
    certificate: false,
  },
  {
    name: "opening close callback replaced by custom button",
    files: replaceFile(
      "action.tsx",
      "return <button className={variant} {...props}>",
      "return <button className={variant}>",
    ),
    certificate: false,
  },
  {
    name: "native direct closing action",
    files: replaceFile(
      "panel.tsx",
      "<ActionButton onClick={() => commitChoice(draft)}>Apply</ActionButton>",
      "<button onClick={() => commitChoice(draft)}>Apply</button>",
    ),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "void content carrier",
    files: replaceFile(
      "content.tsx",
      "<div {...props}>{children}</div>",
      "<input {...props}>{children}</input>",
    ),
    certificate: false,
  },
  {
    name: "inactive template content carrier",
    files: replaceFile(
      "content.tsx",
      "<div {...props}>{children}</div>",
      "<template {...props}>{children}</template>",
    ),
    certificate: false,
  },
  {
    name: "custom built-in content carrier",
    files: replaceFile("content.tsx", "<div {...props}>", '<div is="custom-menu" {...props}>'),
    certificate: false,
  },
  {
    name: "selected options mutated directly",
    files: replaceFile(
      "panel.tsx",
      "  const displayOptions =",
      "  options.splice(0);\n  const displayOptions =",
    ),
    certificate: false,
  },
  {
    name: "selected option alias mutated",
    files: replaceFile(
      "panel.tsx",
      "  const displayOptions =",
      "  const altered = options; altered.splice(0);\n  const displayOptions =",
    ),
    certificate: false,
  },
  {
    name: "selected options opaque escape",
    files: replaceFile(
      "panel.tsx",
      "  const displayOptions =",
      "  publish(options);\n  const displayOptions =",
    ),
    certificate: false,
  },
  {
    name: "selected option find row escapes",
    files: replaceFile(
      "panel.tsx",
      "  const displayOptions =",
      "  const found = options.find((option) => option.value === values); publish(found);\n  const displayOptions =",
    ),
    certificate: false,
  },
  {
    name: "passive selected option label lookup",
    files: replaceFile(
      "panel.tsx",
      "  const displayOptions =",
      "  const label = options.find((option) => option.value === values)?.label;\n  const displayOptions =",
    ),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "passive predicate row mutation",
    files: replaceFile(
      "panel.tsx",
      "  const displayOptions =",
      "  const label = options.find((option) => (option.disabled = true))?.label;\n  const displayOptions =",
    ),
    certificate: false,
  },
  {
    name: "selected state projection under false branch",
    files: replaceFile(
      "entry.tsx",
      "<span>{startIcon}</span>",
      "{false && <span>{startIcon}</span>}",
    ),
    certificate: false,
  },
  {
    name: "selected state projection in attribute",
    files: replaceFile("entry.tsx", "<span>{startIcon}</span>", "<span data-icon={startIcon} />"),
    certificate: false,
  },
  {
    name: "selected state projection in void host",
    files: replaceFile("entry.tsx", "<span>{startIcon}</span>", "<input>{startIcon}</input>"),
    certificate: false,
  },
  {
    name: "selected state projection in inactive host",
    files: replaceFile("entry.tsx", "<span>{startIcon}</span>", "<template>{startIcon}</template>"),
    certificate: false,
  },
  {
    name: "selected state projection in custom built-in",
    files: replaceFile(
      "entry.tsx",
      "<span>{startIcon}</span>",
      '<span is="custom-icon">{startIcon}</span>',
    ),
    certificate: false,
  },
  {
    name: "SDK Trigger ref disables native button",
    files: replaceFile(
      "surface.tsx",
      "<Menu.Trigger asChild",
      "<Menu.Trigger ref={(node) => { if (node) node.disabled = true; }} asChild",
    ),
    certificate: false,
  },
  {
    name: "SDK Content ref removes native menu",
    files: replaceFile(
      "surface.tsx",
      "<Menu.Content style",
      "<Menu.Content ref={(node) => { if (node) node.remove(); }} style",
    ),
    certificate: false,
  },
  {
    name: "record ref disables native item",
    files: replaceFile(
      "panel.tsx",
      "value: choiceValue, onSelect",
      "value: choiceValue, ref: (node) => { if (node) node.disabled = true; }, onSelect",
    ),
    certificate: false,
  },
  {
    name: "own readonly native content ref",
    files: {
      "content.tsx": fixtures["content.tsx"]
        .replace("{ useEffect }", "{ useEffect, useRef }")
        .replace(
          "  useEffect(() => {}, [children]);",
          "  const containerRef = useRef(null); useEffect(() => { const container = containerRef.current; }, [children]);",
        )
        .replace("<div {...props}>", "<div ref={containerRef} {...props}>"),
    },
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "native content alias cannot become inert",
    files: {
      "content.tsx": fixtures["content.tsx"]
        .replace("{ useEffect }", "{ useEffect, useRef }")
        .replace(
          "  useEffect(() => {}, [children]);",
          "  const containerRef = useRef(null); useEffect(() => { const node = containerRef.current; if (node) node.inert = true; }, []);",
        )
        .replace("<div {...props}>", "<div ref={containerRef} {...props}>"),
    },
    certificate: false,
  },
  {
    name: "native content alias cannot escape",
    files: {
      "content.tsx": fixtures["content.tsx"]
        .replace("{ useEffect }", "{ useEffect, useRef }")
        .replace(
          "  useEffect(() => {}, [children]);",
          "  const containerRef = useRef(null); useEffect(() => { const node = containerRef.current; publish(node); }, []);",
        )
        .replace("<div {...props}>", "<div ref={containerRef} {...props}>"),
    },
    certificate: false,
  },
  {
    name: "selected projection suppresses state read",
    files: replaceFile(
      "panel.tsx",
      "startIcon: draft.includes(choiceValue) ?",
      "startIcon: false && draft.includes(choiceValue) ?",
    ),
    certificate: false,
  },
  {
    name: "selected projection has identical outputs",
    files: replaceFile("panel.tsx", '? "Selected" : "Unselected"', '? "Unselected" : "Unselected"'),
    certificate: false,
  },
  {
    name: "declared SDK package alias",
    files: {
      "package.json": '{"dependencies":{"@radix-ui/react-dropdown-menu":"npm:closed-menu@2.1.16"}}',
    },
    certificate: false,
  },
  {
    name: "declared SDK file replacement",
    files: {
      "package.json": '{"dependencies":{"@radix-ui/react-dropdown-menu":"file:../closed-menu"}}',
    },
    certificate: false,
  },
  {
    name: "declared SDK package override",
    files: {
      "package.json": '{"overrides":{"@radix-ui/react-dropdown-menu":"npm:closed-menu@2.1.16"}}',
    },
    certificate: false,
  },
  {
    name: "ordinary declared SDK range",
    files: { "package.json": '{"dependencies":{"@radix-ui/react-dropdown-menu":"^2.1.15"}}' },
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "native query result cannot make descendants inert",
    files: {
      "content.tsx": fixtures["content.tsx"]
        .replace("{ useEffect }", "{ useEffect, useRef }")
        .replace(
          "  useEffect(() => {}, [children]);",
          "  const containerRef = useRef(null); useEffect(() => { const node = containerRef.current; if (!node) return; node.querySelectorAll('*').forEach((child) => { child.inert = true; }); }, []);",
        )
        .replace("<div {...props}>", "<div ref={containerRef} {...props}>"),
    },
    certificate: false,
  },
  {
    name: "native focus query preserves readonly items",
    files: {
      "content.tsx": fixtures["content.tsx"]
        .replace("{ useEffect }", "{ useEffect, useRef }")
        .replace(
          "  useEffect(() => {}, [children]);",
          "  const containerRef = useRef(null); useEffect(() => { const node = containerRef.current; if (!node) return; const items = Array.from(node.querySelectorAll('[role=menuitem]')) as HTMLElement[]; const focusItem = (index) => { if (index >= 0 && index < items.length) items[index]?.focus(); }; const onKeyDown = (event) => { if (event.key === 'Home') focusItem(0); }; node.addEventListener('keydown', onKeyDown); return () => { node.removeEventListener('keydown', onKeyDown); }; }, [children]);",
        )
        .replace("<div {...props}>", "<div ref={containerRef} {...props}>"),
    },
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "native converted query result cannot escape",
    files: {
      "content.tsx": fixtures["content.tsx"]
        .replace("{ useEffect }", "{ useEffect, useRef }")
        .replace(
          "  useEffect(() => {}, [children]);",
          "  const containerRef = useRef(null); useEffect(() => { const node = containerRef.current; if (!node) return; const items = Array.from(node.querySelectorAll('*')); publish(items); }, []);",
        )
        .replace("<div {...props}>", "<div ref={containerRef} {...props}>"),
    },
    certificate: false,
  },
  {
    name: "item focus handler cannot disable its target",
    files: replaceFile(
      "entry.tsx",
      "<Menu.Item data-value",
      "<Menu.Item onFocus={(event) => { event.currentTarget.inert = true; }} data-value",
    ),
    certificate: false,
  },
  {
    name: "item capture focus handler cannot disable its target",
    files: replaceFile(
      "entry.tsx",
      "<Menu.Item data-value",
      "<Menu.Item onFocusCapture={(event) => { event.currentTarget.inert = true; }} data-value",
    ),
    certificate: false,
  },
  {
    name: "custom JSX configuration",
    files: { "tsconfig.json": '{"compilerOptions":{"jsx":"react-jsx","jsxImportSource":"other"}}' },
    certificate: false,
  },
];
const certificateProbe: Rule = {
  id: "supported-radix-pending-draft-certificate",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      for (const fact of collectEffectStateWriteFacts(analysis, context, node, context.filename)) {
        if (hasSupportedRadixPendingDraft(analysis, context, node, fact))
          context.report({ node: fact.callExpression, message: "supported pending draft" });
      }
    },
  }),
};
let temporaryDirectory: string;
const writeFile = (relativePath: string, contents: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
  return filename;
};
const writeFixture = (overrides: DraftFixtureFiles = {}): string => {
  writeFile("tsconfig.json", '{"compilerOptions":{"jsx":"react-jsx"}}');
  for (const [relativePath, contents] of Object.entries({ ...fixtures, ...overrides }))
    writeFile(relativePath, contents);
  resetFilesystemCaches();
  return path.join(temporaryDirectory, "panel.tsx");
};
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pending-draft-"));
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
describe("ordinary supported Radix pending draft", () => {
  it.each(cases)("$name", (fixture) => {
    const filename = writeFixture(fixture.files);
    const code = fs.readFileSync(filename, "utf8");
    const proof = runRule(certificateProbe, code, { filename });
    const result = runRule(noDerivedState, code, { filename });
    expect(proof.parseErrors).toEqual([]);
    expect(result.parseErrors).toEqual([]);
    expect(proof.diagnostics.length > 0).toBe(fixture.certificate);
    if (fixture.diagnostics !== undefined)
      expect(result.diagnostics).toHaveLength(fixture.diagnostics);
  });
  it("captures bridge and grouping reads plus a missing SDK remap target", () => {
    const filename = writeFixture({
      "tsconfig.json":
        '{"compilerOptions":{"jsx":"react-jsx","baseUrl":".","paths":{"@radix-ui/react-dropdown-menu":["./local-menu"]}}}',
    });
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: fixtures["panel.tsx"],
      ruleIds: ["no-derived-state"],
    });
    for (const relativePath of [
      "surface.tsx",
      "entry.tsx",
      "content.tsx",
      "trigger.tsx",
      "group.ts",
      "action.tsx",
      "tsconfig.json",
    ])
      expect(trace?.contentPaths).toContain(path.join(temporaryDirectory, relativePath));
    expect(trace?.existencePaths).toContain(path.join(temporaryDirectory, "local-menu.ts"));
    expect(runRule(certificateProbe, fixtures["panel.tsx"], { filename }).diagnostics).toHaveLength(
      1,
    );
    writeFile("local-menu.ts", "export const Root = Replacement;");
    resetFilesystemCaches();
    expect(runRule(certificateProbe, fixtures["panel.tsx"], { filename }).diagnostics).toHaveLength(
      0,
    );
  });
  it("refreshes equal-size grouping changes after a scan epoch reset", () => {
    const filename = writeFixture();
    const groupingPath = path.join(temporaryDirectory, "group.ts");
    const originalStat = fs.statSync(groupingPath);
    const changed = fixtures["group.ts"].replace("? null : result", "? true : result");
    expect(changed.length).toBe(fixtures["group.ts"].length);
    const phases = [
      { contents: fixtures["group.ts"], count: 1 },
      { contents: changed, count: 0 },
      { contents: fixtures["group.ts"], count: 1 },
    ];
    for (const { contents, count } of phases) {
      fs.writeFileSync(groupingPath, contents);
      fs.utimesSync(groupingPath, originalStat.atime, originalStat.mtime);
      resetFilesystemCaches();
      const result = runRule(certificateProbe, fixtures["panel.tsx"], { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(count);
    }
  });
});
