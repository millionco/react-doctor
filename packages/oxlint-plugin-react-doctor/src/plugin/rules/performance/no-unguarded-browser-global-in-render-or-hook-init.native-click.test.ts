import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

const reactImport = 'import React from "react";';
const nativeButton = "return <button onClick={Activate} />;";
const handlerDeclaration = "function Activate() { console.log(document.title); }";

const check = (source: string) => {
  const result = runRule(noUnguardedBrowserGlobalInRenderOrHookInit, source, {
    filename: "app/page.tsx",
    settings: { "react-doctor": { capabilities: ["react", "ssr"] } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("server render browser globals in closed native click handlers", () => {
  it("keeps the unrelated render warning and skips the click-only declaration", () => {
    const diagnostics = check(`
      ${reactImport}
      export const Panel = () => {
        ${handlerDeclaration}
        return <button onClick={Activate}>{window.innerWidth}</button>;
      };
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("`window`");
  });

  it("skips a const click-only arrow", () => {
    expect(
      check(`
        ${reactImport}
        export const Panel = () => {
          const Activate = () => { console.log(document.title); };
          ${nativeButton}
        };
      `),
    ).toEqual([]);
  });

  it("accepts a native child reached through a branch and fragment", () => {
    expect(
      check(`
        ${reactImport}
        export function Panel({ ready }) {
          ${handlerDeclaration}
          return <div>{ready && (<><button onClick={Activate} /></>)}</div>;
        }
      `),
    ).toEqual([]);
  });

  it.each([
    ["a render-time invocation", "Activate(); return <button />;"],
    ["mixed render and click use", `Activate(); ${nativeButton}`],
    ["JSX component use", "return <Activate />;"],
    ["an opaque component callback prop", "return <Opaque onClick={Activate} />;"],
    [
      "an escape through an alias",
      "const callback = Activate; return <button onClick={callback} />;",
    ],
    ["a possible overriding spread", "return <button onClick={Activate} {...props} />;"],
    ["lexical evaluation that can invoke the function", `eval("Activate()"); ${nativeButton}`],
    ["a write to the declaration binding", `Activate = replacement; ${nativeButton}`],
    [
      "an aliased element consumed during render",
      "const button = <button onClick={Activate} />; button.props.onClick(); return button;",
    ],
    [
      "an element passed to a call during render",
      "const consume = (element) => { element.props.onClick(); return element; }; return consume(<button onClick={Activate} />);",
    ],
    [
      "an element passed as a custom component prop",
      "const Consumer = ({ button }) => { button.props.onClick(); return button; }; return <Consumer button={<button onClick={Activate} />} />;",
    ],
    [
      "an element passed as custom component children",
      "const Consumer = ({ children }) => { children.props.onClick(); return children; }; return <Consumer><button onClick={Activate} /></Consumer>;",
    ],
    ["a shadowed classic runtime", `const React = { createElement: replace }; ${nativeButton}`],
  ])("keeps the warning with %s", (_name, panelBody) => {
    expect(
      check(`${reactImport} export const Panel = (props) => {
      ${handlerDeclaration}
      ${panelBody}
    };`),
    ).toHaveLength(1);
  });

  it.each([
    ["a direct call to the owner", "Panel().props.onClick();"],
    [
      "an owner passed through a JSX element type",
      "const element = <Panel />; element.type().props.onClick();",
    ],
    ["a visible classic factory replacement", "React.createElement = replace;"],
    [
      "an aliased classic factory replacement",
      "const runtime = React; runtime.createElement = replace;",
    ],
    [
      "a TypeScript runtime import of React",
      'import Runtime = require("react"); Runtime.createElement = replace;',
    ],
    [
      "a TypeScript runtime import of a loader",
      'import Loader = require("node:module"); Loader.createRequire(import.meta.url)("react").createElement = replace;',
    ],
    [
      "an imported process loader",
      'import Proc from "node:process"; Proc.getBuiltinModule("node:module").createRequire(import.meta.url)("react").createElement = replace;',
    ],
    [
      "a loader reached from the Function constructor",
      `const load = Function("return process.getBuiltinModule('node:module').createRequire");
        load()(import.meta.url)("react").createElement = replace;`,
    ],
  ])("keeps the warning with %s", (_name, moduleUse) => {
    expect(
      check(`
        ${reactImport}
        export function Panel() {
          ${handlerDeclaration}
          ${nativeButton}
        }
        ${moduleUse}
      `),
    ).toHaveLength(1);
  });

  it.each([
    ["type-only", 'import type Runtime = require("react");'],
    ["unrelated", 'import Path = require("node:path"); Path.resolve(".");'],
  ])("allows a %s import that cannot acquire the JSX provider", (_name, moduleUse) => {
    expect(
      check(`
        ${reactImport}
        export function Panel() {
          ${handlerDeclaration}
          ${nativeButton}
        }
        ${moduleUse}
      `),
    ).toEqual([]);
  });

  it("keeps a warning when the inner declaration binding is used", () => {
    expect(
      check(`
        ${reactImport}
        export const Panel = () => {
          function Activate() { console.log(document.title); Activate(); }
          ${nativeButton}
        };
      `),
    ).toHaveLength(1);
  });

  it("does not assume a custom JSX factory defers a callback", () => {
    expect(
      check(`
        /** @jsx custom */
        ${reactImport}
        export const Panel = () => {
          ${handlerDeclaration}
          ${nativeButton}
        };
      `),
    ).toHaveLength(1);
  });
});
