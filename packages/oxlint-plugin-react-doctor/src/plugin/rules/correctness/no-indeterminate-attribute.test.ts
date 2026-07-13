import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noIndeterminateAttribute } from "./no-indeterminate-attribute.js";

const runRuleForCode = (code: string, filename = "src/checkbox.tsx") =>
  runRule(noIndeterminateAttribute, code, { filename });

describe("no-indeterminate-attribute", () => {
  it("reports attribute calls through typed ref aliases", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      const internalRef = useRef<HTMLInputElement | null>(null);
      const node = internalRef.current;
      node.setAttribute("indeterminate", "true");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("HTMLInputElement.indeterminate");
  });

  it("reports direct ref.current toggleAttribute calls", () => {
    const result = runRuleForCode(`
      import * as React from "react";
      const internalRef = React.useRef<HTMLInputElement>(null);
      internalRef.current?.toggleAttribute("indeterminate", true);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes renamed, default, and namespace React useRef imports", () => {
    const result = runRuleForCode(`
      import ReactClient, { useRef as useReactRef } from "react";
      import * as ReactNamespace from "react";
      const renamedRef = useReactRef<HTMLInputElement | null>(null);
      const defaultRef = ReactClient.useRef<HTMLInputElement | null>(null);
      const namespaceRef = ReactNamespace.useRef<HTMLInputElement | null>(null);
      renamedRef.current?.setAttribute("indeterminate", "true");
      defaultRef.current?.setAttribute("indeterminate", "true");
      namespaceRef.current?.setAttribute("indeterminate", "true");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("requires imported useRef bindings", () => {
    const result = runRuleForCode(`
      const globalRef = useRef<HTMLInputElement | null>(null);
      const globalNamespaceRef = React.useRef<HTMLInputElement | null>(null);
      globalRef.current?.setAttribute("indeterminate", "true");
      globalNamespaceRef.current?.setAttribute("indeterminate", "true");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports calls through transparent TypeScript wrappers", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      const internalRef = useRef<HTMLInputElement | null>(null);
      const node = (internalRef.current as HTMLInputElement | null);
      (node!).setAttribute("indeterminate", "true");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports statically typed HTMLInputElement parameters", () => {
    const result = runRuleForCode(`
      const updateCheckbox = (node: HTMLInputElement) => {
        node.setAttribute("indeterminate", "true");
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports destructured HTMLInputElement parameters", () => {
    const result = runRuleForCode(`
      const updateCheckbox = ({ node }: { node: HTMLInputElement }) => {
        node.setAttribute("indeterminate", "true");
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not report destructured parameters of other element types", () => {
    const result = runRuleForCode(`
      const updateContainer = ({ node }: { node: HTMLDivElement }) => {
        node.setAttribute("indeterminate", "true");
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports native checkbox JSX attribute forms", () => {
    const result = runRuleForCode(`
      const CheckboxExamples = ({ mixed }) => (
        <>
          <input type="checkbox" indeterminate={mixed} />
          <input type={"checkbox"} indeterminate="true" />
          <input type="checkbox" indeterminate={true} />
          <input type="CHECKBOX" indeterminate />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("reports JSX when every spread precedes both explicit attributes", () => {
    const result = runRuleForCode(`
      const CheckboxExamples = ({ props }) => (
        <>
          <input {...props} type="checkbox" indeterminate />
          <input {...props} indeterminate type="checkbox" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not report JSX when a spread occurs between the explicit attributes", () => {
    const result = runRuleForCode(`
      const CheckboxExamples = ({ props }) => (
        <>
          <input type="checkbox" {...props} indeterminate />
          <input indeterminate {...props} type="checkbox" />
          <input {...props} type="checkbox" {...props} indeterminate />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report JSX when a spread follows both explicit attributes", () => {
    const result = runRuleForCode(`
      const CheckboxExamples = ({ props }) => (
        <>
          <input type="checkbox" indeterminate {...props} />
          <input indeterminate type="checkbox" {...props} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report custom components or custom elements", () => {
    const result = runRuleForCode(`
      const Examples = ({ props }) => (
        <>
          <Checkbox indeterminate />
          <Checkbox {...props} type="checkbox" indeterminate />
          <my-checkbox indeterminate="true" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports toggleAttribute with an omitted force argument", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      const internalRef = useRef<HTMLInputElement | null>(null);
      internalRef.current?.toggleAttribute("indeterminate");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports toggleAttribute with a literal true force argument", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      const internalRef = useRef<HTMLInputElement | null>(null);
      internalRef.current?.toggleAttribute("indeterminate", true);
      internalRef.current?.toggleAttribute("indeterminate", true as boolean);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not report toggleAttribute with a literal false force argument", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      const internalRef = useRef<HTMLInputElement | null>(null);
      internalRef.current?.toggleAttribute("indeterminate", false);
      internalRef.current?.toggleAttribute("indeterminate", false as boolean);
      internalRef.current?.toggleAttribute("indeterminate", false satisfies boolean);
      internalRef.current?.toggleAttribute("indeterminate", false!);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report toggleAttribute with a dynamic force argument", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      const internalRef = useRef<HTMLInputElement | null>(null);
      internalRef.current?.toggleAttribute("indeterminate", force);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report unknown DOM targets, jQuery attr calls, or query selectors", () => {
    const result = runRuleForCode(`
      element.setAttribute("indeterminate", "true");
      element.toggleAttribute("indeterminate");
      $(element).attr("indeterminate", true);
      document.querySelector("input[type=checkbox]")?.setAttribute("indeterminate", "true");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report dynamic names, removeAttribute, or property assignment", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      const internalRef = useRef<HTMLInputElement | null>(null);
      const node = internalRef.current;
      node?.setAttribute(attributeName, "true");
      node?.removeAttribute("indeterminate");
      if (node) node.indeterminate = Boolean(value);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report non-input refs", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      const internalRef = useRef<HTMLDivElement | null>(null);
      internalRef.current?.setAttribute("indeterminate", "true");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("respects shadowed aliases and useRef bindings", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";
      import ReactClient from "react";
      const internalRef = useRef<HTMLInputElement | null>(null);
      const node = internalRef.current;
      {
        const node = getUnknownElement();
        node.setAttribute("indeterminate", "true");
      }
      const render = () => {
        const useRef = <Value,>(value: Value) => ({ current: value });
        const localRef = useRef<HTMLInputElement | null>(null);
        localRef.current?.setAttribute("indeterminate", "true");
      };
      const renderWithNamespace = (ReactClient) => {
        const localRef = ReactClient.useRef<HTMLInputElement | null>(null);
        localRef.current?.setAttribute("indeterminate", "true");
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report shadowed DOM type names", () => {
    const result = runRuleForCode(`
      interface HTMLInputElement extends HTMLDivElement {}
      const update = (node: HTMLInputElement) => {
        node.setAttribute("indeterminate", "true");
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat enclosing generic type parameters as the native DOM type", () => {
    const result = runRuleForCode(`
      import { useRef } from "react";

      function updateInFunction<HTMLInputElement>(node: HTMLInputElement) {
        node.setAttribute("indeterminate", "true");
        const internalRef = useRef<HTMLInputElement | null>(null);
        internalRef.current?.setAttribute("indeterminate", "true");
      }

      const updateInArrow = <HTMLInputElement,>(node: HTMLInputElement) => {
        node.setAttribute("indeterminate", "true");
      };

      const updateInExpression = function <HTMLInputElement>(node: HTMLInputElement) {
        node.setAttribute("indeterminate", "true");
      };

      class CheckboxController<HTMLInputElement> {
        update(node: HTMLInputElement) {
          node.setAttribute("indeterminate", "true");
        }
      }

      class CheckboxMethodController {
        update<HTMLInputElement>(node: HTMLInputElement) {
          node.setAttribute("indeterminate", "true");
        }
      }

      type InputUpdater<HTMLInputElement> = (node: HTMLInputElement) => void;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat aliases or qualified type names as the native DOM type", () => {
    const result = runRuleForCode(`
      namespace LocalDom {
        export interface HTMLInputElement extends HTMLDivElement {}
      }

      type HTMLInputElement = HTMLDivElement;
      type NativeInputAlias = globalThis.HTMLInputElement;

      const updateAlias = (node: HTMLInputElement) => {
        node.setAttribute("indeterminate", "true");
      };
      const updateQualified = (node: LocalDom.HTMLInputElement) => {
        node.setAttribute("indeterminate", "true");
      };
      const updateUnresolvedAlias = (node: NativeInputAlias) => {
        node.setAttribute("indeterminate", "true");
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat function-local type aliases as the native DOM type", () => {
    const result = runRuleForCode(`
      const update = () => {
        type HTMLInputElement = HTMLDivElement;
        const node: HTMLInputElement = getNode();
        node.setAttribute("indeterminate", "true");
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires a statically proven checkbox type in JSX", () => {
    const result = runRuleForCode(`
      const Examples = ({ type }) => (
        <>
          <input type={type} indeterminate />
          <input type="text" indeterminate={true} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("skips React Native targets", () => {
    const result = runRuleForCode(
      `
        const Example = () => <input type="checkbox" indeterminate />;
      `,
      "src/checkbox.native.tsx",
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
