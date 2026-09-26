import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { preferModuleScopePureFunction } from "../rules/architecture/prefer-module-scope-pure-function.js";
import { jsxHandlerNames } from "../rules/react-builtins/jsx-handler-names.js";
import { noUnknownProperty } from "../rules/react-builtins/no-unknown-property.js";
import { defineRule } from "./define-rule.js";

const rules = [jsxHandlerNames, noUnknownProperty, preferModuleScopePureFunction];
const component = `
  export const Panel = (props) => {
    const stopEvent = (event) => event.stopPropagation();
    return <section class="panel"><Button click={props.onClick} /></section>;
  };
`;

describe("solid-applicability", () => {
  for (const rule of rules) {
    describe(rule.id, () => {
      it.each([
        'import { Show as Conditional } from "solid-js";',
        'import "solid-js/web";',
        'import { jsx } from "solid-js/jsx-runtime";',
        'import type { Component } from "solid-js";',
        'import { type Component as View } from "solid-js";',
        'import type { JSX } from "solid-js";',
        'import { type JSX as SolidJSX } from "solid-js";',
      ])("skips native Solid JSX with %s", (imports) => {
        const result = runRule(rule, imports + component);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      });

      it.each([
        "",
        'import type { Accessor } from "solid-js";',
        'import { type Accessor as Component } from "solid-js";',
        'import type * as Solid from "solid-js";',
        'import type { Component } from "./types";',
        'import type { Component } from "solid-js-userland";',
        'import type { Component } from "solid-js/store";',
      ])("preserves React diagnostics with unrelated imports: %s", (imports) => {
        const result = runRule(rule, imports + component);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(1);
      });

      it.each([
        'import React from "react";',
        'import { useState as state } from "react";',
        'import { jsx } from "react/jsx-runtime";',
        'import { createRoot } from "react-dom/client";',
        'import { h } from "preact";',
      ])("preserves mixed-runtime diagnostics with %s", (reactImport) => {
        const result = runRule(
          rule,
          `${reactImport}
          import type { Component, JSX } from "solid-js";
          import { createSignal } from "solid-js";
          ${component}
          const marker = <div classList={{ active: true }} on:click={props.onClick} />;`,
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics.length).toBeGreaterThan(0);
      });

      it.each([
        "<div classList={{ active: true }} />",
        "<div on:pointerdown={props.onPointerDown} />",
        "<div oncapture:click={props.onClick} />",
        "<div class:active={true} />",
        "<input bind:value={value} />",
      ])("recognizes a late explicit native dialect marker: %s", (marker) => {
        const result = runRule(rule, `${component} const marker = ${marker};`);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      });

      it("does not infer a dialect from a namespaced component API or SVG attribute", () => {
        const result = runRule(
          rule,
          `${component}
          const custom = <Widget on:click={callback} />;
          const icon = <svg xmlns:xlink="http://www.w3.org/1999/xlink" />;`,
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(1);
      });
    });
  }

  it("does not rename Solid Show's conditional callback-presence props", () => {
    const result = runRule(
      jsxHandlerNames,
      `import { Show as Conditional } from "solid-js";
      export const Panel = (props) => <Conditional when={props.onRetry}>
        <button on:pointerdown={props.onPointerDown} />
      </Conditional>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves ambiguous JSX return types without native dialect syntax", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `import type { JSX } from "solid-js";
      export const Panel = (): JSX.Element => {
        const stopEvent = (event) => event.stopPropagation();
        return <div onClick={stopEvent} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not apply rerender advice to a typed Solid component without JSX", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `import type { Component as View } from "solid-js";
      export const Panel: View = () => {
        const parseSize = (value) => Number.parseFloat(value);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps React class diagnostics active after a Solid marker", () => {
    const result = runRule(
      noUnknownProperty,
      `import React from "react";
      export const Panel = () => <>
        <div classList={{ active: true }} />
        <div class="wrong" />
      </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("gates Program diagnostics as well as node visitors", () => {
    const rule = defineRule({
      id: "solid-applicability-program",
      severity: "warn",
      tags: ["react-jsx-only"],
      create: (context) => ({
        Program: (node) => context.report({ node, message: "React-only diagnostic" }),
      }),
    });
    expect(runRule(rule, 'import type { Component } from "solid-js";').diagnostics).toEqual([]);
    expect(runRule(rule, 'import React from "react";').diagnostics).toHaveLength(1);
  });
});
