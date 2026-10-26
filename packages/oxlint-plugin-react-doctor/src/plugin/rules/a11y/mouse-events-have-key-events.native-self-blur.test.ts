import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mouseEventsHaveKeyEvents } from "./mouse-events-have-key-events.js";

interface NativeSelfBlurCase {
  name: string;
  code: string;
  expectedCount: number;
  settings?: Readonly<Record<string, unknown>>;
}

const cases: NativeSelfBlurCase[] = [
  {
    name: "native button has only same-target blur",
    code: "<button onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 0,
  },
  {
    name: "parameter spelling does not matter",
    code: "<button onMouseOut={pointer => pointer.currentTarget.blur()} />",
    expectedCount: 0,
  },
  {
    name: "ordinary click callback stays opaque",
    code: "export const Action = ({ activate }) => <button onClick={activate} onMouseOut={event => event.currentTarget.blur()}>Run</button>;",
    expectedCount: 0,
  },
  {
    name: "source-only React types do not veto provider",
    code: 'import React from "react"; export const Action = () => <button onMouseOut={(event: React.MouseEvent<HTMLElement>) => event.currentTarget.blur()} />;',
    expectedCount: 0,
  },
  {
    name: "transparent receiver wrappers",
    code: "<button onMouseOut={event => ((event as React.MouseEvent<HTMLButtonElement>)).currentTarget.blur()} />",
    expectedCount: 0,
  },
  {
    name: "transparent target wrappers",
    code: "<button onMouseOut={event => (event.currentTarget!).blur()} />",
    expectedCount: 0,
  },
  {
    name: "transparent call wrapper",
    code: "<button onMouseOut={event => (event.currentTarget.blur())} />",
    expectedCount: 0,
  },
  {
    name: "explicit missing counterpart remains redundant",
    code: "<button onMouseOut={event => event.currentTarget.blur()} onBlur={undefined} />",
    expectedCount: 0,
  },
  {
    name: "native children do not change sole handler",
    code: '<button className="action" onMouseOut={event => event.currentTarget.blur()}><svg><path d="M0 0 L2 2" /></svg></button>',
    expectedCount: 0,
  },
  {
    name: "unrelated native parent and type declarations",
    code: "interface Model { node: HTMLElement; factory: typeof Object; } export const Action = () => <header><button onMouseOut={event => event.currentTarget.blur()} /></header>;",
    expectedCount: 0,
  },
  {
    name: "ordinary data and module calls stay opaque",
    code: 'const label = translate("action"); export const Action = ({ activate }) => <button title={label} onClick={activate} onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 0,
  },
  {
    name: "ordinary asset import expression is not runtime loader reflection",
    code: 'const icon = browser.assets.load(require("icons/" + theme + ".png")); export const Action = () => <button data-icon={icon} onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 0,
  },
  {
    name: "foreign receiver",
    code: "<button onMouseOut={event => another.blur()} />",
    expectedCount: 1,
  },
  {
    name: "target receiver",
    code: "<button onMouseOut={event => event.target.blur()} />",
    expectedCount: 1,
  },
  {
    name: "focus action",
    code: "<button onMouseOut={event => event.currentTarget.focus()} />",
    expectedCount: 1,
  },
  {
    name: "blur argument",
    code: "<button onMouseOut={event => event.currentTarget.blur(true)} />",
    expectedCount: 1,
  },
  {
    name: "optional target",
    code: "<button onMouseOut={event => event.currentTarget?.blur()} />",
    expectedCount: 1,
  },
  {
    name: "optional method",
    code: "<button onMouseOut={event => event.currentTarget.blur?.()} />",
    expectedCount: 1,
  },
  {
    name: "computed target",
    code: "<button onMouseOut={event => event['currentTarget'].blur()} />",
    expectedCount: 1,
  },
  {
    name: "computed method",
    code: "<button onMouseOut={event => event.currentTarget['blur']()} />",
    expectedCount: 1,
  },
  {
    name: "default parameter",
    code: "<button onMouseOut={(event = fallback) => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "destructured parameter",
    code: "<button onMouseOut={({ currentTarget }) => currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "rest parameter",
    code: "<button onMouseOut={(...events) => events[0].currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "additional parameter",
    code: "<button onMouseOut={(event, extra) => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "async callback",
    code: "<button onMouseOut={async event => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "ordinary function callback",
    code: "<button onMouseOut={function (event) { return event.currentTarget.blur(); }} />",
    expectedCount: 1,
  },
  {
    name: "block body",
    code: "<button onMouseOut={event => { event.currentTarget.blur(); }} />",
    expectedCount: 1,
  },
  {
    name: "returned callback",
    code: "<button onMouseOut={event => () => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "sequence effects",
    code: "<button onMouseOut={event => (notify(), event.currentTarget.blur())} />",
    expectedCount: 1,
  },
  {
    name: "conditional action",
    code: "<button onMouseOut={event => enabled && event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "saved callback",
    code: "const handleOut = event => event.currentTarget.blur(); <button onMouseOut={handleOut} />",
    expectedCount: 1,
  },
  {
    name: "receiver alias",
    code: "<button onMouseOut={event => { const target = event.currentTarget; target.blur(); }} />",
    expectedCount: 1,
  },
  {
    name: "selected ref transport",
    code: "<button onMouseOut={event => event.currentTarget.blur()} ref={nodeRef} />",
    expectedCount: 1,
  },
  {
    name: "custom element is",
    code: '<button onMouseOut={event => event.currentTarget.blur()} is="managed-action" />',
    expectedCount: 1,
  },
  {
    name: "polymorphic as",
    code: '<button onMouseOut={event => event.currentTarget.blur()} as="div" />',
    expectedCount: 1,
  },
  {
    name: "polymorphic child",
    code: "<button onMouseOut={event => event.currentTarget.blur()} asChild />",
    expectedCount: 1,
  },
  {
    name: "preceding spread",
    code: "<button {...attributes} onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "following spread",
    code: "<button onMouseOut={event => event.currentTarget.blur()} {...attributes} />",
    expectedCount: 1,
  },
  {
    name: "duplicate mouseout attributes",
    code: "<button onMouseOut={event => event.currentTarget.blur()} onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "duplicate unrelated attributes",
    code: '<button title="first" title="second" onMouseOut={event => event.currentTarget.blur()} />',
    expectedCount: 1,
  },
  {
    name: "mapped component remains unsupported",
    code: "<Control onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 1,
    settings: {
      "jsx-a11y": {
        components: {
          Control: "button",
        },
      },
    },
  },
  {
    name: "non-button intrinsic remains reported",
    code: "<div onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "hover-in behavior is preserved",
    code: "<button onMouseOver={showTip} onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "configured different hover-out action stays reported",
    code: "<button onMouseLeave={event => event.currentTarget.blur()} />",
    expectedCount: 1,
    settings: {
      "react-doctor": {
        mouseEventsHaveKeyEvents: {
          hoverOutHandlers: ["onMouseLeave"],
        },
      },
    },
  },
  {
    name: "later configured hover-out action stays reported",
    code: "<button onMouseOut={event => event.currentTarget.blur()} onMouseLeave={hideTip} />",
    expectedCount: 1,
    settings: {
      "react-doctor": {
        mouseEventsHaveKeyEvents: {
          hoverOutHandlers: ["onMouseOut", "onMouseLeave"],
        },
      },
    },
  },
  {
    name: "local JSX factory pragma stays outside native profile",
    code: "/** @jsx renderNode */\n<button onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "automatic runtime import source pragma stays outside profile",
    code: "/** @jsxImportSource custom-renderer */\n<button onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "global native prototype override",
    code: "HTMLElement.prototype.blur = replacement;\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "native provider alias",
    code: "const NativeElement = HTMLElement; NativeElement.prototype.blur = replacement;\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "erased provider binding",
    code: "declare const HTMLElement: any; HTMLElement.prototype.blur = replacement;\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "native instance direct override",
    code: "const prepare = event => { event.currentTarget.blur = replacement; };\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "native instance receiver alias override",
    code: "const prepare = event => { const target = event.currentTarget; target.blur = replacement; };\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "computed static blur override",
    code: "const property = 'blur'; const prepare = event => { event.currentTarget[property] = replacement; };\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "destructuring blur write",
    code: "const prepare = event => { ({ method: event.currentTarget.blur } = source); };\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "delete instance method",
    code: "const prepare = event => { delete event.currentTarget.blur; };\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "reflective native override",
    code: "Reflect.set(HTMLElement.prototype, 'blur', replacement);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "raw reflection alias",
    code: "const { defineProperty } = Object; defineProperty(receiver, 'blur', { value: replacement });\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "destructured function constructor",
    code: "const { constructor: compile } = () => {}; compile(source)();\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "unknown computed capability",
    code: "const key = ['constructor'][0]; (() => {})[key](source)();\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "global namespace alias",
    code: "const host = globalThis; host.HTMLElement.prototype.blur = replacement;\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "global React factory override",
    code: "React.createElement = replacement;\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "imported React factory override",
    code: 'import Renderer from "react"; Renderer.createElement = replacement;\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "imported JSX factory override",
    code: 'import * as Runtime from "react/jsx-runtime"; Runtime.jsx = replacement;\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "known virtual machine capability",
    code: 'import * as evaluator from "node:vm"; evaluator.runInThisContext(source);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "require virtual machine capability",
    code: 'const evaluator = require("vm"); evaluator.runInThisContext(source);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "dynamic loader capability",
    code: "import(provider);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "string timer evaluation",
    code: 'setTimeout("HTMLElement.prototype.blur = replacement", 0);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "unrelated unknown computed member remains conservative",
    code: "const value = data[key];\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "inline click replaces the instance method",
    code: "<button onClick={event => { event.currentTarget.blur = replacement; }} onMouseOut={event => event.currentTarget.blur()} />",
    expectedCount: 1,
  },
  {
    name: "timer alias can evaluate a string",
    code: 'const later = setTimeout; later("HTMLElement.prototype.blur = replacement", 0);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "interval alias can evaluate a string",
    code: 'const later = setInterval; later("HTMLElement.prototype.blur = replacement", 0);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "runtime import equals can acquire an evaluator",
    code: 'import evaluator = require("node:vm"); evaluator.runInThisContext("HTMLElement.prototype.blur = replacement");\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "runtime namespace can replace native method",
    code: "namespace Patch { HTMLElement.prototype.blur = replacement; }\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "runtime enum initializer can replace native method",
    code: "enum Patch { Changed = (HTMLElement.prototype.blur = replacement, 0) }\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "parameter property initializer can replace native method",
    code: "class Patch { constructor(private value = (HTMLElement.prototype.blur = replacement)) {} }\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "export assignment can replace native method",
    code: "export = (HTMLElement.prototype.blur = replacement);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "direct arrow timer preserves ordinary profile",
    code: "setTimeout(() => setLoading(true), Math.random() * 1500);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 0,
  },
  {
    name: "direct function timer preserves ordinary profile",
    code: "setTimeout(function () { setLoading(true); }, 0);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 0,
  },
  {
    name: "direct interval callback preserves ordinary profile",
    code: "setInterval(() => setLoading(true), 100);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 0,
  },
  {
    name: "type only evaluator import stays erased",
    code: 'import type Evaluator = require("node:vm"); interface Model { node: HTMLElement; }\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 0,
  },
  {
    name: "ordinary React import equals stays supported",
    code: 'import React = require("react");\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 0,
  },
  {
    name: "erased namespace stays supported",
    code: "namespace Model { export interface Entry { node: HTMLElement; } }\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 0,
  },
  {
    name: "unknown timer callback remains unsupported",
    code: "setTimeout(callback, 0);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "missing timer callback declines without inspecting an absent node",
    code: "setTimeout();\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;",
    expectedCount: 1,
  },
  {
    name: "runtime import equals cannot alias the timer capability",
    code: 'import later = setTimeout; later("HTMLElement.prototype.blur = replacement", 0);\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "global require value cannot escape into an evaluator alias",
    code: 'const load = require; load("node:vm").runInThisContext("HTMLElement.prototype.blur = replacement");\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "readonly module source can acquire a native evaluator",
    code: 'const source = "node:vm"; const evaluator = require(source); evaluator.runInThisContext("HTMLElement.prototype.blur = replacement");\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
  {
    name: "concatenated module source can acquire a native evaluator",
    code: 'const evaluator = require("node:" + "vm"); evaluator.runInThisContext("HTMLElement.prototype.blur = replacement");\nexport const Action = () => <button onMouseOut={event => event.currentTarget.blur()} />;',
    expectedCount: 1,
  },
];

describe("native button self-blur keyboard parity", () => {
  it.each(cases)("$name", ({ code, expectedCount, settings }) => {
    const result = runRule(mouseEventsHaveKeyEvents, code, {
      filename: "action.tsx",
      settings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
